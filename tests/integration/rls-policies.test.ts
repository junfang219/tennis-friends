import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  anonClient,
  befriend,
  deleteTestUsers,
  integrationEnvReady,
  makeTestUser,
  type TestUser,
} from "./_helpers";

// Multi-persona RLS isolation test.
//
// Personas:
//   alice — owns the post / event / chat under test
//   bob   — friend of alice
//   carol — stranger (no friendship, no shared group)
//
// The test exercises each visibility branch end-to-end against the live
// Supabase project: RLS policies + helper functions + auth.users trigger that
// auto-populates profiles. If the schema ever drifts from the policies, this
// suite is the canary.

describe.skipIf(!integrationEnvReady)("RLS policies (live Supabase)", () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;

  beforeAll(async () => {
    [alice, bob, carol] = await Promise.all([
      makeTestUser("alice"),
      makeTestUser("bob"),
      makeTestUser("carol"),
    ]);
    await befriend(alice, bob);
  }, 60_000);

  afterAll(async () => {
    if (alice || bob || carol) {
      await deleteTestUsers([alice, bob, carol].filter(Boolean));
    }
  }, 60_000);

  describe("profiles", () => {
    it("auto-creates a profile row via the auth.users trigger", async () => {
      const admin = adminClient();
      const { data } = await admin
        .from("profiles")
        .select("id, name")
        .in("id", [alice.id, bob.id, carol.id]);
      expect(data?.length).toBe(3);
    });

    it("non-private profiles are visible to any authenticated user", async () => {
      const { data, error } = await carol.client
        .from("profiles")
        .select("id")
        .eq("id", alice.id);
      expect(error).toBeNull();
      expect(data?.length).toBe(1);
    });

    it("private profiles are hidden from strangers but visible to friends", async () => {
      await alice.client.from("profiles").update({ is_private: true }).eq("id", alice.id);

      const strangerView = await carol.client
        .from("profiles")
        .select("id")
        .eq("id", alice.id);
      expect(strangerView.data?.length).toBe(0);

      const friendView = await bob.client
        .from("profiles")
        .select("id")
        .eq("id", alice.id);
      expect(friendView.data?.length).toBe(1);

      const selfView = await alice.client
        .from("profiles")
        .select("id")
        .eq("id", alice.id);
      expect(selfView.data?.length).toBe(1);

      await alice.client.from("profiles").update({ is_private: false }).eq("id", alice.id);
    });

    it("a user cannot update someone else's profile", async () => {
      const { error } = await carol.client
        .from("profiles")
        .update({ name: "PWNED" })
        .eq("id", alice.id);
      // RLS update with no matching row returns success with 0 rows updated
      // (not an error). Verify by re-reading.
      expect(error).toBeNull();
      const { data } = await alice.client
        .from("profiles")
        .select("name")
        .eq("id", alice.id)
        .single();
      expect(data?.name).not.toBe("PWNED");
    });
  });

  describe("posts: visibility branches", () => {
    let friendPostId: string;
    let groupPostId: string;
    let privatePostId: string;
    let groupId: string;

    beforeAll(async () => {
      // Friend-default post: no targeting, no broadcast.
      const { data: fp } = await alice.client
        .from("posts")
        .insert({ author_id: alice.id, content: "friend-visible-post" })
        .select("id")
        .single();
      friendPostId = fp!.id;

      // Private Playbook-style entry: author-only regardless of friendship.
      const { data: pp } = await alice.client
        .from("posts")
        .insert({ author_id: alice.id, content: "private-note", post_type: "note", visibility: "private" })
        .select("id")
        .single();
      privatePostId = pp!.id;

      // Group-targeted post: alice creates a group, adds carol, targets the post.
      const { data: g } = await alice.client
        .from("groups")
        .insert({ name: "test-group", owner_id: alice.id })
        .select("id")
        .single();
      groupId = g!.id;
      // groups_auto_add_owner trigger writes alice's owner row.
      await adminClient()
        .from("group_members")
        .insert([
          { group_id: groupId, user_id: carol.id, roles: [] },
        ]);

      const { data: gp } = await alice.client
        .from("posts")
        .insert({ author_id: alice.id, content: "group-targeted-post" })
        .select("id")
        .single();
      groupPostId = gp!.id;
      await alice.client
        .from("post_targets")
        .insert({ post_id: groupPostId, target_kind: "group", group_id: groupId });
    });

    it("author sees their own post", async () => {
      const { data } = await alice.client
        .from("posts")
        .select("id")
        .eq("id", friendPostId);
      expect(data?.length).toBe(1);
    });

    it("friend sees a default-visibility post", async () => {
      const { data } = await bob.client
        .from("posts")
        .select("id")
        .eq("id", friendPostId);
      expect(data?.length).toBe(1);
    });

    it("stranger does NOT see a default-visibility post", async () => {
      const { data } = await carol.client
        .from("posts")
        .select("id")
        .eq("id", friendPostId);
      expect(data?.length).toBe(0);
    });

    it("private post is author-only — hidden even from a friend", async () => {
      // Bob is alice's accepted friend; private must still hard-stop him.
      const friendView = await bob.client
        .from("posts")
        .select("id")
        .eq("id", privatePostId);
      expect(friendView.data?.length).toBe(0);

      const selfView = await alice.client
        .from("posts")
        .select("id")
        .eq("id", privatePostId);
      expect(selfView.data?.length).toBe(1);
    });

    it("targeted-group post is visible to members of that group", async () => {
      const { data } = await carol.client
        .from("posts")
        .select("id")
        .eq("id", groupPostId);
      expect(data?.length).toBe(1);
    });

    it("targeted-group post is NOT visible to non-members (even friends)", async () => {
      // Bob is alice's friend but NOT a member of the target group.
      const { data } = await bob.client
        .from("posts")
        .select("id")
        .eq("id", groupPostId);
      expect(data?.length).toBe(0);
    });

    it("anyone authenticated can read groups directory", async () => {
      const { data } = await carol.client.from("groups").select("id").eq("id", groupId);
      expect(data?.length).toBe(1);
    });

    it("group members can list other members; non-members cannot", async () => {
      const carolView = await carol.client
        .from("group_members")
        .select("user_id")
        .eq("group_id", groupId);
      expect(carolView.data?.length).toBeGreaterThan(0);

      const bobView = await bob.client
        .from("group_members")
        .select("user_id")
        .eq("group_id", groupId);
      expect(bobView.data?.length).toBe(0);
    });
  });

  // Looking-for-Player requests fired off from inside a chat scope the feed
  // post to exactly that chat's audience via two post_targets kinds:
  //   'user' → a single recipient (a 1-on-1 DM request)
  //   'chat' → the participants of a session chat
  describe("posts: chat-scoped visibility (user/chat targets)", () => {
    let userPostId: string;
    let chatPostId: string;
    let chatId: string;

    beforeAll(async () => {
      // user-targeted post: alice targets carol directly (not a friend of
      // alice's via the group; bob is alice's friend but NOT the target).
      const { data: up } = await alice.client
        .from("posts")
        .insert({ author_id: alice.id, content: "dm-targeted-post" })
        .select("id")
        .single();
      userPostId = up!.id;
      await alice.client
        .from("post_targets")
        .insert({ post_id: userPostId, target_kind: "user", target_user_id: carol.id });

      // chat-targeted post: a session chat with alice + carol as participants.
      const admin = adminClient();
      const { data: c } = await admin
        .from("chats")
        .insert({ name: "test-session-chat", creator_id: alice.id })
        .select("id")
        .single();
      chatId = c!.id;
      await admin.from("chat_participants").insert([
        { chat_id: chatId, user_id: alice.id },
        { chat_id: chatId, user_id: carol.id },
      ]);

      const { data: cp } = await alice.client
        .from("posts")
        .insert({ author_id: alice.id, content: "chat-targeted-post" })
        .select("id")
        .single();
      chatPostId = cp!.id;
      await alice.client
        .from("post_targets")
        .insert({ post_id: chatPostId, target_kind: "chat", chat_id: chatId });
    });

    it("user-targeted post is visible to the targeted recipient", async () => {
      const { data } = await carol.client.from("posts").select("id").eq("id", userPostId);
      expect(data?.length).toBe(1);
    });

    it("user-targeted post is visible to the author", async () => {
      const { data } = await alice.client.from("posts").select("id").eq("id", userPostId);
      expect(data?.length).toBe(1);
    });

    it("user-targeted post is NOT visible to a non-target (even a friend)", async () => {
      // Bob is alice's friend but is not the targeted user.
      const { data } = await bob.client.from("posts").select("id").eq("id", userPostId);
      expect(data?.length).toBe(0);
    });

    it("chat-targeted post is visible to a chat participant", async () => {
      const { data } = await carol.client.from("posts").select("id").eq("id", chatPostId);
      expect(data?.length).toBe(1);
    });

    it("chat-targeted post is NOT visible to a non-participant (even a friend)", async () => {
      // Bob is alice's friend but not a participant of the targeted chat.
      const { data } = await bob.client.from("posts").select("id").eq("id", chatPostId);
      expect(data?.length).toBe(0);
    });
  });

  describe("blocks", () => {
    let blockId: string | null = null;

    it("blocker can read their own block rows; blocked cannot", async () => {
      const { data: ins } = await alice.client
        .from("blocks")
        .insert({ blocker_id: alice.id, blocked_id: carol.id })
        .select("id")
        .single();
      blockId = ins?.id ?? null;
      expect(blockId).toBeTruthy();

      const carolView = await carol.client
        .from("blocks")
        .select("id")
        .eq("id", blockId!);
      expect(carolView.data?.length).toBe(0);

      const aliceView = await alice.client
        .from("blocks")
        .select("id")
        .eq("id", blockId!);
      expect(aliceView.data?.length).toBe(1);
    });

    it("blocked user cannot see blocker's broadcast post", async () => {
      // Create a broadcast post by alice; carol is blocked.
      const { data } = await alice.client
        .from("posts")
        .insert({
          author_id: alice.id,
          content: "broadcast-while-blocked",
          is_broadcast: true,
          broadcast_lat: 47.6062,
          broadcast_lng: -122.3321,
          broadcast_radius_mi: 5,
        })
        .select("id")
        .single();
      const postId = data?.id;

      // Put carol's profile location near Seattle so the radius check would otherwise pass.
      await carol.client
        .from("profiles")
        .update({ latitude: 47.6062, longitude: -122.3321 })
        .eq("id", carol.id);

      const carolView = await carol.client
        .from("posts")
        .select("id")
        .eq("id", postId!);
      // Even though carol is in the broadcast radius, the block bidirectionally
      // hides the post.
      expect(carolView.data?.length).toBe(0);
    });

    it("blocker can unblock", async () => {
      if (!blockId) return;
      const { error } = await alice.client.from("blocks").delete().eq("id", blockId);
      expect(error).toBeNull();
    });
  });

  describe("messages (DMs)", () => {
    let messageId: string;

    it("sender can insert a DM to a friend", async () => {
      const { data, error } = await alice.client
        .from("messages")
        .insert({
          sender_id: alice.id,
          receiver_id: bob.id,
          content: "hi bob",
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
      messageId = data!.id;
    });

    it("only sender and receiver can read the DM", async () => {
      const senderView = await alice.client
        .from("messages")
        .select("id")
        .eq("id", messageId);
      expect(senderView.data?.length).toBe(1);

      const receiverView = await bob.client
        .from("messages")
        .select("id")
        .eq("id", messageId);
      expect(receiverView.data?.length).toBe(1);

      const eavesdropper = await carol.client
        .from("messages")
        .select("id")
        .eq("id", messageId);
      expect(eavesdropper.data?.length).toBe(0);
    });

    it("a third party cannot impersonate another user as sender", async () => {
      const { error } = await carol.client.from("messages").insert({
        sender_id: alice.id, // forged
        receiver_id: bob.id,
        content: "I am alice",
      });
      expect(error).not.toBeNull();
    });
  });

  describe("helpers", () => {
    // The generated Database type doesn't include our custom RPC functions
    // (Supabase only generates types for ones in the api schemas). Cast
    // through unknown to bypass — runtime behavior is what we're testing.
    type Rpc = (
      name: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;

    it("is_blocked is callable by authenticated but not by anon", async () => {
      // Authenticated CAN call it (needed for the messages policy that
      // references is_blocked directly). Returns a boolean only — no PII.
      const ok = await (alice.client.rpc as unknown as Rpc)("is_blocked", {
        a: alice.id,
        b: bob.id,
      });
      expect(ok.error).toBeNull();
      expect(typeof ok.data).toBe("boolean");

      // Anon (no JWT) cannot — we REVOKEd EXECUTE from anon.
      const anon = anonClient();
      const denied = await (anon.rpc as unknown as Rpc)("is_blocked", {
        a: alice.id,
        b: bob.id,
      });
      expect(denied.error).not.toBeNull();
    });
  });

  describe("anon role", () => {
    it("anonymous (no JWT) reads return zero rows on RLS-protected tables", async () => {
      const anon = anonClient();
      const { data, error } = await anon.from("posts").select("id").limit(1);
      // Lockdown is correct in either of two forms: a permission error,
      // or a successful query that returns zero rows because no policy
      // matched the anon role.
      if (error) {
        expect(error.code).toBeTruthy();
      } else {
        expect(data?.length ?? 0).toBe(0);
      }
    });
  });

  // Independent multi-role model: manager = ADMIN, captain = OPS, owner = both.
  // Exercises can_admin_group / can_run_group, the role-change guard trigger,
  // and the transfer_group_ownership RPC against the live DB.
  describe("team role capabilities + guards", () => {
    let groupId: string;

    beforeAll(async () => {
      const admin = adminClient();
      const { data: g } = await admin
        .from("groups")
        .insert({ name: "Role Caps Test", owner_id: alice.id })
        .select("id")
        .single();
      groupId = g!.id;
      // owner row auto-added by the trigger; add bob + carol as plain members.
      await admin.from("group_members").insert([
        { group_id: groupId, user_id: bob.id, roles: [] },
        { group_id: groupId, user_id: carol.id, roles: [] },
      ]);
    }, 60_000);

    afterAll(async () => {
      if (groupId) await adminClient().from("groups").delete().eq("id", groupId);
    });

    const rolesOf = (u: TestUser) =>
      adminClient()
        .from("group_members")
        .select("roles")
        .eq("group_id", groupId)
        .eq("user_id", u.id)
        .single();

    it("a member cannot grant themselves the Manager role", async () => {
      const { error } = await bob.client
        .from("group_members")
        .update({ roles: ["manager"] })
        .eq("group_id", groupId)
        .eq("user_id", bob.id);
      expect(error).not.toBeNull();
      const { data } = await rolesOf(bob);
      expect(data?.roles).toEqual([]);
    });

    it("only the owner can grant Manager — a manager cannot", async () => {
      const admin = adminClient();
      await admin
        .from("group_members")
        .update({ roles: ["manager"] })
        .eq("group_id", groupId)
        .eq("user_id", bob.id);

      // Manager bob tries to make carol a manager → blocked by the guard.
      const mgr = await bob.client
        .from("group_members")
        .update({ roles: ["manager"] })
        .eq("group_id", groupId)
        .eq("user_id", carol.id);
      expect(mgr.error).not.toBeNull();

      // But bob (a manager = admin) CAN grant carol the captain role.
      const cap = await bob.client
        .from("group_members")
        .update({ roles: ["captain"] })
        .eq("group_id", groupId)
        .eq("user_id", carol.id);
      expect(cap.error).toBeNull();
      const { data } = await rolesOf(carol);
      expect(data?.roles).toEqual(["captain"]);
    });

    it("Manager (admin) and Captain (ops) capabilities are independent", async () => {
      const admin = adminClient();
      // bob = captain only, carol = manager only.
      await admin.from("group_members").update({ roles: ["captain"] }).eq("group_id", groupId).eq("user_id", bob.id);
      await admin.from("group_members").update({ roles: ["manager"] }).eq("group_id", groupId).eq("user_id", carol.id);

      // OPS: a captain can create a season; a manager-only member cannot.
      const capSeason = await bob.client
        .from("seasons")
        .insert({ group_id: groupId, name: "Captain Season" })
        .select("id")
        .single();
      expect(capSeason.error).toBeNull();
      const mgrSeason = await carol.client
        .from("seasons")
        .insert({ group_id: groupId, name: "Manager Season" });
      expect(mgrSeason.error).not.toBeNull();

      // ADMIN: a manager can rename the team; a captain-only member cannot.
      const rename = await carol.client.from("groups").update({ name: "Renamed by Manager" }).eq("id", groupId);
      expect(rename.error).toBeNull();
      await bob.client.from("groups").update({ name: "Captain Rename Attempt" }).eq("id", groupId);
      const { data: grp } = await admin.from("groups").select("name").eq("id", groupId).single();
      expect(grp?.name).toBe("Renamed by Manager");

      if (capSeason.data?.id) await admin.from("seasons").delete().eq("id", capSeason.data.id);
    });

    it("the owner keeps both capabilities with an empty role set", async () => {
      const admin = adminClient();
      const { data: ownerRow } = await rolesOf(alice);
      expect(ownerRow?.roles).toEqual([]);

      const season = await alice.client
        .from("seasons")
        .insert({ group_id: groupId, name: "Owner Season" })
        .select("id")
        .single();
      expect(season.error).toBeNull(); // OPS
      const rename = await alice.client.from("groups").update({ name: "Renamed by Owner" }).eq("id", groupId);
      expect(rename.error).toBeNull(); // ADMIN

      if (season.data?.id) await admin.from("seasons").delete().eq("id", season.data.id);
    });

    it("transfer_group_ownership: owner-only, member target, founder kept on", async () => {
      // A non-owner cannot transfer.
      const denied = await bob.client.rpc("transfer_group_ownership", {
        p_group_id: groupId,
        p_new_owner_id: bob.id,
      });
      expect(denied.error).not.toBeNull();

      // The owner cannot transfer to a non-member.
      const stranger = await makeTestUser("stranger");
      const badTarget = await alice.client.rpc("transfer_group_ownership", {
        p_group_id: groupId,
        p_new_owner_id: stranger.id,
      });
      expect(badTarget.error).not.toBeNull();
      await deleteTestUsers([stranger]);

      // The owner transfers to bob (a member).
      const ok = await alice.client.rpc("transfer_group_ownership", {
        p_group_id: groupId,
        p_new_owner_id: bob.id,
      });
      expect(ok.error).toBeNull();

      const admin = adminClient();
      const { data: grp } = await admin.from("groups").select("owner_id").eq("id", groupId).single();
      expect(grp?.owner_id).toBe(bob.id);
      // The outgoing owner is retained as manager + captain.
      const { data: aliceRow } = await rolesOf(alice);
      expect(new Set(aliceRow?.roles)).toEqual(new Set(["manager", "captain"]));
    });
  });

  // New matches/practices are stamped with the team's active season so the
  // calendar can scope by season.
  describe("season auto-tagging", () => {
    let groupId: string;

    afterAll(async () => {
      if (groupId) await adminClient().from("groups").delete().eq("id", groupId);
    });

    it("tags new matches/practices with the active season, null when none", async () => {
      const { data: g } = await alice.client
        .from("groups")
        .insert({ name: "Season Tag Test", owner_id: alice.id })
        .select("id")
        .single();
      groupId = g!.id;

      // No active season yet → match stays unseasoned.
      const m0 = await alice.client
        .from("team_matches")
        .insert({ group_id: groupId, match_date: "2026-06-01", match_time: "18:00", location: "Magnuson", opponent: "TBD" })
        .select("season_id")
        .single();
      expect(m0.error).toBeNull();
      expect(m0.data?.season_id).toBeNull();

      // Activate a season.
      const { data: season } = await alice.client
        .from("seasons")
        .insert({ group_id: groupId, name: "Summer 2026", is_active: true })
        .select("id")
        .single();

      // New match + practice series pick up the active season automatically.
      const m1 = await alice.client
        .from("team_matches")
        .insert({ group_id: groupId, match_date: "2026-07-01", match_time: "18:00", location: "Magnuson", opponent: "TBD" })
        .select("season_id")
        .single();
      expect(m1.data?.season_id).toBe(season!.id);

      const ps = await alice.client
        .from("practice_series")
        .insert({ group_id: groupId, name: "Drills", practice_time: "19:00", location: "Woodland" })
        .select("season_id")
        .single();
      expect(ps.data?.season_id).toBe(season!.id);
    });
  });

  // Match details (location/time) often change after posting, so the
  // availability page lets captains edit a match in place. Verify the
  // team_matches_update_captain policy: captain can edit, member cannot.
  describe("team match editing", () => {
    let groupId: string;
    let matchId: string;

    beforeAll(async () => {
      const admin = adminClient();
      const { data: g } = await admin
        .from("groups")
        .insert({ name: "Match Edit Test", owner_id: alice.id })
        .select("id")
        .single();
      groupId = g!.id;
      // owner row auto-added by the trigger; bob is a plain member.
      await admin.from("group_members").insert({ group_id: groupId, user_id: bob.id, roles: [] });

      const { data: m } = await alice.client
        .from("team_matches")
        .insert({ group_id: groupId, match_date: "2026-07-10", match_time: "18:00", location: "Magnuson" })
        .select("id")
        .single();
      matchId = m!.id;
    }, 60_000);

    afterAll(async () => {
      if (groupId) await adminClient().from("groups").delete().eq("id", groupId);
    });

    it("the captain can edit a match's date/time/location after posting", async () => {
      const { data, error } = await alice.client
        .from("team_matches")
        .update({ match_date: "2026-07-11", match_time: "19:30", location: "Lower Woodland", opponent: "Greenlake Smashers", notes: "Court moved" })
        .eq("id", matchId)
        .select("match_date, match_time, location, opponent, notes")
        .single();
      expect(error).toBeNull();
      expect(data).toMatchObject({
        match_date: "2026-07-11",
        match_time: "19:30",
        location: "Lower Woodland",
        opponent: "Greenlake Smashers",
        notes: "Court moved",
      });
    });

    it("a non-captain member cannot edit the match", async () => {
      // RLS update with no matching row returns success with 0 rows updated
      // (not an error). Verify by re-reading.
      const { error } = await bob.client
        .from("team_matches")
        .update({ location: "PWNED" })
        .eq("id", matchId);
      expect(error).toBeNull();
      const { data } = await adminClient()
        .from("team_matches")
        .select("location")
        .eq("id", matchId)
        .single();
      expect(data?.location).toBe("Lower Woodland");
    });
  });

  // The availability page lets a captain fill in/override any member's
  // availability for matches AND practices on their behalf. Verify the
  // availabilities_{update,insert}_self_or_captain policies: captain can write
  // another member's row; a non-captain member can only write their own.
  describe("captain edits member availability", () => {
    let groupId: string;
    let matchId: string;
    let practiceId: string;

    beforeAll(async () => {
      const admin = adminClient();
      const { data: g } = await admin
        .from("groups")
        .insert({ name: "Avail Captain Test", owner_id: alice.id })
        .select("id")
        .single();
      groupId = g!.id;
      // alice = owner (captain). bob = plain member, carol = stranger.
      await admin.from("group_members").insert({ group_id: groupId, user_id: bob.id, roles: [] });

      const { data: m } = await admin
        .from("team_matches")
        .insert({ group_id: groupId, match_date: "2026-08-01", match_time: "18:00", location: "Magnuson" })
        .select("id")
        .single();
      matchId = m!.id;

      const { data: ps } = await admin
        .from("practice_series")
        .insert({ group_id: groupId, name: "Drills", practice_time: "19:00", location: "Woodland" })
        .select("id")
        .single();
      const { data: tp } = await admin
        .from("team_practices")
        .insert({ series_id: ps!.id, practice_date: "2026-08-02" })
        .select("id")
        .single();
      practiceId = tp!.id;
    }, 60_000);

    afterAll(async () => {
      if (groupId) await adminClient().from("groups").delete().eq("id", groupId);
    });

    it("the captain can set another member's MATCH availability", async () => {
      const { error } = await alice.client
        .from("availabilities")
        .upsert(
          { event_kind: "match", match_id: matchId, user_id: bob.id, status: "playing", match_types: "singles" },
          { onConflict: "match_id,user_id" }
        );
      expect(error).toBeNull();
      const { data } = await adminClient()
        .from("availabilities")
        .select("status, match_types")
        .eq("match_id", matchId)
        .eq("user_id", bob.id)
        .single();
      expect(data).toMatchObject({ status: "playing", match_types: "singles" });
    });

    it("the captain can override an existing member MATCH availability", async () => {
      const { error } = await alice.client
        .from("availabilities")
        .upsert(
          { event_kind: "match", match_id: matchId, user_id: bob.id, status: "not_playing", match_types: "doubles" },
          { onConflict: "match_id,user_id" }
        );
      expect(error).toBeNull();
      const { data } = await adminClient()
        .from("availabilities")
        .select("status, match_types")
        .eq("match_id", matchId)
        .eq("user_id", bob.id)
        .single();
      expect(data).toMatchObject({ status: "not_playing", match_types: "doubles" });
    });

    it("the captain can set another member's PRACTICE availability", async () => {
      const { error } = await alice.client
        .from("availabilities")
        .upsert(
          { event_kind: "practice", practice_id: practiceId, user_id: bob.id, status: "playing" },
          { onConflict: "practice_id,user_id" }
        );
      expect(error).toBeNull();
      const { data } = await adminClient()
        .from("availabilities")
        .select("status")
        .eq("practice_id", practiceId)
        .eq("user_id", bob.id)
        .single();
      expect(data?.status).toBe("playing");
    });

    it("a non-captain member cannot write another member's availability", async () => {
      // bob (plain member) tries to set alice's match availability. INSERT is
      // blocked by the WITH CHECK; surfaces as an RLS error.
      const { error } = await bob.client
        .from("availabilities")
        .upsert(
          { event_kind: "match", match_id: matchId, user_id: alice.id, status: "not_playing", match_types: "" },
          { onConflict: "match_id,user_id" }
        );
      expect(error).not.toBeNull();
      const { data } = await adminClient()
        .from("availabilities")
        .select("id")
        .eq("match_id", matchId)
        .eq("user_id", alice.id);
      expect(data?.length).toBe(0);
    });
  });
});
