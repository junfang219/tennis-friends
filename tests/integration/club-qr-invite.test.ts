import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  deleteTestUsers,
  integrationEnvReady,
  makeTestUser,
  type TestUser,
} from "./_helpers";
import { leaveClub } from "@/lib/supabase/queries";

// Reusable club QR invite link (friend_group_invite_links) end-to-end against
// the live project. This is the feature that lets a club bring in NON-friends /
// non-users: friend_group_invites needs an existing friend, but the QR link is
// a bearer token anyone signed in can redeem.
//
// Personas:
//   owner   — creates the club, mints the QR link
//   joinerA — NO relationship to owner; joins via the link
//   joinerB — NO relationship to owner; joins via the SAME link (reusable)
//   stranger— never joins; used to prove the member-gate on minting

describe.skipIf(!integrationEnvReady)("Club QR invite link (live Supabase)", () => {
  let owner: TestUser;
  let joinerA: TestUser;
  let joinerB: TestUser;
  let stranger: TestUser;
  let outsider: TestUser;

  let clubId: string;
  let chatId: string;
  let token: string;

  beforeAll(async () => {
    [owner, joinerA, joinerB, stranger, outsider] = await Promise.all([
      makeTestUser("cqr-owner"),
      makeTestUser("cqr-joinerA"),
      makeTestUser("cqr-joinerB"),
      makeTestUser("cqr-stranger"),
      makeTestUser("cqr-outsider"),
    ]);
    const { data, error } = await owner.client.rpc("create_club", {
      p_name: "QR Hitters",
      p_invitee_ids: [],
    });
    expect(error).toBeNull();
    const result = data as { club_id: string; chat_id: string };
    clubId = result.club_id;
    chatId = result.chat_id;
  }, 60_000);

  afterAll(async () => {
    if (owner || joinerA || joinerB || stranger || outsider) {
      await deleteTestUsers([owner, joinerA, joinerB, stranger, outsider].filter(Boolean));
    }
  }, 60_000);

  describe("get_or_create_club_invite_link", () => {
    it("a member mints a link and it is idempotent (stable QR)", async () => {
      const { data, error } = await owner.client.rpc("get_or_create_club_invite_link", {
        p_friend_group_id: clubId,
      });
      expect(error).toBeNull();
      const r = data as { token: string; club_name: string; friend_group_id: string };
      expect(r.token).toBeTruthy();
      expect(r.club_name).toBe("QR Hitters");
      expect(r.friend_group_id).toBe(clubId);
      token = r.token;

      const { data: again, error: againErr } = await owner.client.rpc(
        "get_or_create_club_invite_link",
        { p_friend_group_id: clubId }
      );
      expect(againErr).toBeNull();
      expect((again as { token: string }).token).toBe(token);

      // Exactly one link row for the club.
      const admin = adminClient();
      const { data: rows } = await admin
        .from("friend_group_invite_links")
        .select("id")
        .eq("friend_group_id", clubId);
      expect(rows?.length).toBe(1);
    });

    it("a non-member cannot mint a link", async () => {
      const { error } = await stranger.client.rpc("get_or_create_club_invite_link", {
        p_friend_group_id: clubId,
      });
      expect(error).not.toBeNull();
    });
  });

  describe("get_club_invite_link (public preview)", () => {
    it("returns the club + inviter for the landing page", async () => {
      const { data, error } = await joinerA.client.rpc("get_club_invite_link", {
        p_token: token,
      });
      expect(error).toBeNull();
      const r = data as { friend_group_id: string; club_name: string; inviter_name: string };
      expect(r.friend_group_id).toBe(clubId);
      expect(r.club_name).toBe("QR Hitters");
      expect(typeof r.inviter_name).toBe("string");
    });

    it("returns null for an unknown token", async () => {
      const { data, error } = await joinerA.client.rpc("get_club_invite_link", {
        p_token: "deadbeefdeadbeefdeadbeefdeadbeef",
      });
      expect(error).toBeNull();
      expect(data).toBeNull();
    });
  });

  describe("accept_club_invite_link", () => {
    it("a non-friend joins the club + its chat via the link", async () => {
      const { data, error } = await joinerA.client.rpc("accept_club_invite_link", {
        p_token: token,
      });
      expect(error).toBeNull();
      const r = data as { ok: boolean; friend_group_id: string; chat_id: string };
      expect(r.ok).toBe(true);
      expect(r.friend_group_id).toBe(clubId);
      expect(r.chat_id).toBe(chatId);

      const admin = adminClient();
      const { data: member } = await admin
        .from("friend_group_members")
        .select("id")
        .eq("friend_group_id", clubId)
        .eq("user_id", joinerA.id);
      expect(member?.length).toBe(1);

      const { data: participant } = await admin
        .from("chat_participants")
        .select("user_id")
        .eq("chat_id", chatId)
        .eq("user_id", joinerA.id);
      expect(participant?.length).toBe(1);

      // The joiner can now read the club chat (RLS via chat_participants).
      const { data: chatRow, error: chatErr } = await joinerA.client
        .from("chats")
        .select("id")
        .eq("id", chatId);
      expect(chatErr).toBeNull();
      expect(chatRow?.length).toBe(1);
    });

    it("is reusable — a second person joins from the SAME token", async () => {
      const { data, error } = await joinerB.client.rpc("accept_club_invite_link", {
        p_token: token,
      });
      expect(error).toBeNull();
      expect((data as { ok: boolean }).ok).toBe(true);

      const admin = adminClient();
      const { data: roster } = await admin
        .from("friend_group_members")
        .select("user_id")
        .eq("friend_group_id", clubId);
      expect(roster?.map((m) => m.user_id).sort()).toEqual(
        [owner.id, joinerA.id, joinerB.id].sort()
      );
    });

    it("rejects an unknown token", async () => {
      const { error } = await joinerB.client.rpc("accept_club_invite_link", {
        p_token: "deadbeefdeadbeefdeadbeefdeadbeef",
      });
      expect(error).not.toBeNull();
    });
  });

  describe("rotate_club_invite_link", () => {
    it("get_or_create reports ownership (owner=true, member=false)", async () => {
      const { data: asOwner } = await owner.client.rpc("get_or_create_club_invite_link", {
        p_friend_group_id: clubId,
      });
      expect((asOwner as { is_owner: boolean }).is_owner).toBe(true);
      // joinerA is a member (joined earlier) but not the owner.
      const { data: asMember } = await joinerA.client.rpc("get_or_create_club_invite_link", {
        p_friend_group_id: clubId,
      });
      expect((asMember as { is_owner: boolean }).is_owner).toBe(false);
    });

    it("a non-owner member cannot rotate", async () => {
      const { error } = await joinerA.client.rpc("rotate_club_invite_link", {
        p_friend_group_id: clubId,
      });
      expect(error).not.toBeNull();
    });

    it("the owner rotates: new token works, old token is dead", async () => {
      const oldToken = token;
      const { data, error } = await owner.client.rpc("rotate_club_invite_link", {
        p_friend_group_id: clubId,
      });
      expect(error).toBeNull();
      const newToken = (data as { token: string }).token;
      expect(newToken).toBeTruthy();
      expect(newToken).not.toBe(oldToken);

      // Old token no longer resolves...
      const { data: oldPreview } = await outsider.client.rpc("get_club_invite_link", {
        p_token: oldToken,
      });
      expect(oldPreview).toBeNull();

      // ...and can't be accepted.
      const { error: oldAcceptErr } = await outsider.client.rpc("accept_club_invite_link", {
        p_token: oldToken,
      });
      expect(oldAcceptErr).not.toBeNull();

      // New token works: a fresh outsider joins with it.
      const { data: accepted, error: acceptErr } = await outsider.client.rpc(
        "accept_club_invite_link",
        { p_token: newToken }
      );
      expect(acceptErr).toBeNull();
      expect((accepted as { ok: boolean }).ok).toBe(true);

      token = newToken;
    });

    it("still only one link row after rotation", async () => {
      const admin = adminClient();
      const { data: rows } = await admin
        .from("friend_group_invite_links")
        .select("id")
        .eq("friend_group_id", clubId);
      expect(rows?.length).toBe(1);
    });
  });

  describe("RLS on friend_group_invite_links", () => {
    it("a member can read the link row; a non-member cannot", async () => {
      const { data: asMember } = await joinerA.client
        .from("friend_group_invite_links")
        .select("token")
        .eq("friend_group_id", clubId);
      expect(asMember?.length).toBe(1);

      const { data: asStranger } = await stranger.client
        .from("friend_group_invite_links")
        .select("token")
        .eq("friend_group_id", clubId);
      expect(asStranger?.length).toBe(0);
    });
  });

  // Invite-link expiry (guardrail B). The club member cap (guardrail A, 100)
  // can't be exercised here without minting 100 auth users, so it's verified
  // by a rolled-back DB-level functional test instead; this covers expiry,
  // which is feasible with the existing personas + the service-role client.
  describe("invite link expiry", () => {
    it("get_or_create returns an expires_at roughly 30 days out", async () => {
      const { data } = await owner.client.rpc("get_or_create_club_invite_link", {
        p_friend_group_id: clubId,
      });
      const r = data as { expires_at: string };
      expect(r.expires_at).toBeTruthy();
      const days = (new Date(r.expires_at).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(25);
      expect(days).toBeLessThan(35);
    });

    it("an expired link is flagged by preview and rejected on accept", async () => {
      const admin = adminClient();
      const past = new Date(Date.now() - 86_400_000).toISOString();
      const { error: upErr } = await admin
        .from("friend_group_invite_links")
        .update({ expires_at: past })
        .eq("friend_group_id", clubId);
      expect(upErr).toBeNull();

      const { data: preview } = await stranger.client.rpc("get_club_invite_link", {
        p_token: token,
      });
      expect((preview as { expired: boolean }).expired).toBe(true);

      const { error: acceptErr } = await stranger.client.rpc("accept_club_invite_link", {
        p_token: token,
      });
      expect(acceptErr).not.toBeNull();

      // The rejected attempt did not add stranger to the club.
      const { data: m } = await admin
        .from("friend_group_members")
        .select("id")
        .eq("friend_group_id", clubId)
        .eq("user_id", stranger.id);
      expect(m?.length).toBe(0);
    });

    it("viewing the QR refreshes expiry, re-enabling joins", async () => {
      const { data } = await owner.client.rpc("get_or_create_club_invite_link", {
        p_friend_group_id: clubId,
      });
      expect(new Date((data as { expires_at: string }).expires_at).getTime()).toBeGreaterThan(
        Date.now()
      );

      const { data: preview } = await stranger.client.rpc("get_club_invite_link", {
        p_token: token,
      });
      expect((preview as { expired: boolean }).expired).toBe(false);

      const { data: accepted, error } = await stranger.client.rpc("accept_club_invite_link", {
        p_token: token,
      });
      expect(error).toBeNull();
      expect((accepted as { ok: boolean }).ok).toBe(true);
    });
  });

  // Voluntary leave: a member removes themselves from the club + its chat.
  describe("leaving a club", () => {
    it("a member leaves: removed from the club and its chat, loses chat access", async () => {
      await leaveClub(joinerB.client, clubId); // joinerB joined earlier

      const admin = adminClient();
      const { data: mem } = await admin
        .from("friend_group_members")
        .select("id")
        .eq("friend_group_id", clubId)
        .eq("user_id", joinerB.id);
      expect(mem?.length).toBe(0);

      const { data: part } = await admin
        .from("chat_participants")
        .select("user_id")
        .eq("chat_id", chatId)
        .eq("user_id", joinerB.id);
      expect(part?.length).toBe(0);

      // RLS: the leaver can no longer read the club chat.
      const { data: chatRow } = await joinerB.client.from("chats").select("id").eq("id", chatId);
      expect(chatRow?.length).toBe(0);

      // The club and the owner are unaffected.
      const { data: roster } = await admin
        .from("friend_group_members")
        .select("user_id")
        .eq("friend_group_id", clubId);
      expect(roster?.some((m) => m.user_id === owner.id)).toBe(true);
      expect(roster?.some((m) => m.user_id === joinerB.id)).toBe(false);
    });

    it("a member who left can rejoin via the link (the seat is freed)", async () => {
      const { error } = await joinerB.client.rpc("accept_club_invite_link", { p_token: token });
      expect(error).toBeNull();

      const admin = adminClient();
      const { data: mem } = await admin
        .from("friend_group_members")
        .select("id")
        .eq("friend_group_id", clubId)
        .eq("user_id", joinerB.id);
      expect(mem?.length).toBe(1);
    });
  });
});
