import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  befriend,
  deleteTestUsers,
  integrationEnvReady,
  makeTestUser,
  type TestUser,
} from "./_helpers";

// Clubs (friend_groups.kind='club') end-to-end against the live project.
//
// Personas:
//   owner    — creates the club, friend of memberB only
//   memberB  — friend of owner; invited at creation; accepts
//   friendC  — friend of memberB ONLY (the whole point of clubs: B can
//              bring C in even though C doesn't know the owner)
//   stranger — no relationships; must see nothing
//
// Covers: create_club RPC (club + chat + creator membership + initial
// invites + notifications), invite RLS (member-only, own-friends-only,
// clubs-only), accept_club_invite (membership + chat join + notification
// swap), decline + re-invite, post visibility via post_targets, and the
// no-RLS-recursion canary.

describe.skipIf(!integrationEnvReady)("Clubs (live Supabase)", () => {
  let owner: TestUser;
  let memberB: TestUser;
  let friendC: TestUser;
  let stranger: TestUser;

  let clubId: string;
  let chatId: string;
  let inviteBId: string;
  let inviteCId: string;

  beforeAll(async () => {
    [owner, memberB, friendC, stranger] = await Promise.all([
      makeTestUser("club-owner"),
      makeTestUser("club-memberB"),
      makeTestUser("club-friendC"),
      makeTestUser("club-stranger"),
    ]);
    await befriend(owner, memberB);
    await befriend(memberB, friendC); // C is NOT a friend of owner
  }, 60_000);

  afterAll(async () => {
    // Club + chat cascade away with the owner's profile via
    // cleanup_user_for_test + auth user delete.
    if (owner || memberB || friendC || stranger) {
      await deleteTestUsers([owner, memberB, friendC, stranger].filter(Boolean));
    }
  }, 60_000);

  describe("create_club", () => {
    it("creates the club, its chat, creator membership, and the initial invite", async () => {
      const { data, error } = await owner.client.rpc("create_club", {
        p_name: "Test Hitters",
        p_invitee_ids: [memberB.id],
      });
      expect(error).toBeNull();
      const result = data as { club_id: string; chat_id: string };
      clubId = result.club_id;
      chatId = result.chat_id;
      expect(clubId).toBeTruthy();
      expect(chatId).toBeTruthy();

      const admin = adminClient();
      const { data: club } = await admin
        .from("friend_groups")
        .select("kind, owner_id, name")
        .eq("id", clubId)
        .single();
      expect(club?.kind).toBe("club");
      expect(club?.owner_id).toBe(owner.id);

      const { data: members } = await admin
        .from("friend_group_members")
        .select("user_id")
        .eq("friend_group_id", clubId);
      expect(members?.map((m) => m.user_id)).toEqual([owner.id]);

      const { data: participants } = await admin
        .from("chat_participants")
        .select("user_id")
        .eq("chat_id", chatId);
      expect(participants?.map((p) => p.user_id)).toEqual([owner.id]);

      const { data: invites } = await admin
        .from("friend_group_invites")
        .select("id, invitee_id, status")
        .eq("friend_group_id", clubId);
      expect(invites?.length).toBe(1);
      expect(invites?.[0].invitee_id).toBe(memberB.id);
      expect(invites?.[0].status).toBe("pending");
      inviteBId = invites![0].id;
    });

    it("notifies the invitee with a club_invite notification carrying the club id", async () => {
      const { data } = await memberB.client
        .from("notifications")
        .select("type, actor_id, friend_group_id")
        .eq("user_id", memberB.id)
        .eq("type", "club_invite");
      expect(data?.length).toBe(1);
      expect(data?.[0].actor_id).toBe(owner.id);
      expect(data?.[0].friend_group_id).toBe(clubId);
    });

    it("skips invitees who aren't the creator's friends", async () => {
      const { data } = await owner.client.rpc("create_club", {
        p_name: "No Strangers",
        p_invitee_ids: [friendC.id], // not a friend of owner
      });
      const result = data as { club_id: string };
      const admin = adminClient();
      const { data: invites } = await admin
        .from("friend_group_invites")
        .select("id")
        .eq("friend_group_id", result.club_id);
      expect(invites?.length).toBe(0);
      await admin.from("friend_groups").delete().eq("id", result.club_id);
    });
  });

  describe("RLS before accept", () => {
    it("the invitee can read the club row (to render its name)", async () => {
      const { data, error } = await memberB.client
        .from("friend_groups")
        .select("id, name")
        .eq("id", clubId);
      expect(error).toBeNull();
      expect(data?.[0]?.name).toBe("Test Hitters");
    });

    it("a stranger sees neither the club nor its roster nor its invites", async () => {
      const [club, members, invites] = await Promise.all([
        stranger.client.from("friend_groups").select("id").eq("id", clubId),
        stranger.client.from("friend_group_members").select("id").eq("friend_group_id", clubId),
        stranger.client.from("friend_group_invites").select("id").eq("friend_group_id", clubId),
      ]);
      expect(club.error).toBeNull(); // no recursion blow-up
      expect(club.data?.length).toBe(0);
      expect(members.data?.length).toBe(0);
      expect(invites.data?.length).toBe(0);
    });

    it("a non-member cannot insert an invite", async () => {
      const { error } = await friendC.client.from("friend_group_invites").insert({
        friend_group_id: clubId,
        inviter_id: friendC.id,
        invitee_id: stranger.id,
      });
      expect(error).not.toBeNull();
    });
  });

  describe("accept_club_invite", () => {
    it("only the invitee can accept", async () => {
      const { error } = await stranger.client.rpc("accept_club_invite", {
        p_invite_id: inviteBId,
      });
      expect(error).not.toBeNull();
    });

    it("adds membership, joins the chat, and swaps the notifications", async () => {
      const { data, error } = await memberB.client.rpc("accept_club_invite", {
        p_invite_id: inviteBId,
      });
      expect(error).toBeNull();
      const result = data as { ok: boolean; friend_group_id: string; chat_id: string };
      expect(result.ok).toBe(true);
      expect(result.friend_group_id).toBe(clubId);
      expect(result.chat_id).toBe(chatId);

      const admin = adminClient();
      const { data: member } = await admin
        .from("friend_group_members")
        .select("id")
        .eq("friend_group_id", clubId)
        .eq("user_id", memberB.id);
      expect(member?.length).toBe(1);

      const { data: participant } = await admin
        .from("chat_participants")
        .select("id")
        .eq("chat_id", chatId)
        .eq("user_id", memberB.id);
      expect(participant?.length).toBe(1);

      // Invite marked accepted; invitee's club_invite notification cleaned
      // up; inviter notified of the acceptance.
      const { data: invite } = await admin
        .from("friend_group_invites")
        .select("status")
        .eq("id", inviteBId)
        .single();
      expect(invite?.status).toBe("accepted");

      const { data: staleNotif } = await admin
        .from("notifications")
        .select("id")
        .eq("user_id", memberB.id)
        .eq("type", "club_invite")
        .eq("friend_group_id", clubId);
      expect(staleNotif?.length).toBe(0);

      const { data: acceptedNotif } = await admin
        .from("notifications")
        .select("actor_id")
        .eq("user_id", owner.id)
        .eq("type", "club_invite_accepted")
        .eq("friend_group_id", clubId);
      expect(acceptedNotif?.length).toBe(1);
      expect(acceptedNotif?.[0].actor_id).toBe(memberB.id);
    });

    it("member roster reads don't recurse (Option-A RLS canary)", async () => {
      const { data, error } = await memberB.client
        .from("friend_group_members")
        .select("user_id")
        .eq("friend_group_id", clubId);
      expect(error).toBeNull();
      expect(data?.map((m) => m.user_id).sort()).toEqual([owner.id, memberB.id].sort());
    });
  });

  describe("member-driven invites", () => {
    it("a member can invite their OWN friend (who doesn't know the owner)", async () => {
      const { data, error } = await memberB.client
        .from("friend_group_invites")
        .insert({ friend_group_id: clubId, inviter_id: memberB.id, invitee_id: friendC.id })
        .select("id, status")
        .single();
      expect(error).toBeNull();
      expect(data?.status).toBe("pending");
      inviteCId = data!.id;
    });

    it("a member cannot invite someone who is not their friend", async () => {
      const { error } = await memberB.client.from("friend_group_invites").insert({
        friend_group_id: clubId,
        inviter_id: memberB.id,
        invitee_id: stranger.id,
      });
      expect(error).not.toBeNull();
    });

    it("invites cannot target circles", async () => {
      const { data: circle } = await owner.client
        .from("friend_groups")
        .insert({ name: "My Circle", owner_id: owner.id }) // kind defaults to circle
        .select("id")
        .single();
      const { error } = await owner.client.from("friend_group_invites").insert({
        friend_group_id: circle!.id,
        inviter_id: owner.id,
        invitee_id: memberB.id,
      });
      expect(error).not.toBeNull();
      await owner.client.from("friend_groups").delete().eq("id", circle!.id);
    });
  });

  describe("decline and re-invite", () => {
    it("decline marks the invite and removes the bell notification", async () => {
      const { error } = await friendC.client
        .from("friend_group_invites")
        .update({ status: "declined" })
        .eq("id", inviteCId);
      expect(error).toBeNull();

      const admin = adminClient();
      const { data: notif } = await admin
        .from("notifications")
        .select("id")
        .eq("user_id", friendC.id)
        .eq("type", "club_invite")
        .eq("friend_group_id", clubId);
      expect(notif?.length).toBe(0);
    });

    it("the inviter can re-send a declined invite, which re-notifies", async () => {
      const { error } = await memberB.client
        .from("friend_group_invites")
        .update({ status: "pending" })
        .eq("id", inviteCId);
      expect(error).toBeNull();

      const { data: notif } = await friendC.client
        .from("notifications")
        .select("id")
        .eq("user_id", friendC.id)
        .eq("type", "club_invite")
        .eq("friend_group_id", clubId);
      expect(notif?.length).toBe(1);
    });

    it("accepting after re-invite makes C a member of a club whose owner they don't know", async () => {
      const { data, error } = await friendC.client.rpc("accept_club_invite", {
        p_invite_id: inviteCId,
      });
      expect(error).toBeNull();
      expect((data as { ok: boolean }).ok).toBe(true);

      const { data: roster } = await friendC.client
        .from("friend_group_members")
        .select("user_id")
        .eq("friend_group_id", clubId);
      expect(roster?.length).toBe(3);
    });
  });

  describe("club posts", () => {
    let postId: string;

    it("a member's post targeted at the club is visible to other members", async () => {
      // friendC posts to the club — exactly the "this club is now their own"
      // behavior: C never friended the owner.
      const { data: post, error: postErr } = await friendC.client
        .from("posts")
        .insert({ author_id: friendC.id, content: "Anyone up for doubles?" })
        .select("id")
        .single();
      expect(postErr).toBeNull();
      postId = post!.id;

      const { error: targetErr } = await friendC.client.from("post_targets").insert({
        post_id: postId,
        target_kind: "friend_group",
        friend_group_id: clubId,
      });
      expect(targetErr).toBeNull();

      const { data: seenByOwner } = await owner.client
        .from("posts")
        .select("id")
        .eq("id", postId);
      expect(seenByOwner?.length).toBe(1);
    });

    it("non-members can't see club posts", async () => {
      const { data } = await stranger.client.from("posts").select("id").eq("id", postId);
      expect(data?.length).toBe(0);
    });
  });

  describe("leave", () => {
    it("a member can leave the club and its chat", async () => {
      await friendC.client
        .from("chat_participants")
        .delete()
        .eq("chat_id", chatId)
        .eq("user_id", friendC.id);
      const { error } = await friendC.client
        .from("friend_group_members")
        .delete()
        .eq("friend_group_id", clubId)
        .eq("user_id", friendC.id);
      expect(error).toBeNull();

      const admin = adminClient();
      const { data: roster } = await admin
        .from("friend_group_members")
        .select("user_id")
        .eq("friend_group_id", clubId);
      expect(roster?.length).toBe(2);
    });
  });
});
