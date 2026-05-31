import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  deleteTestUsers,
  integrationEnvReady,
  makeTestUser,
  type TestUser,
} from "./_helpers";

// Coverage for migrations 0010 / 0011 / 0012 (schema consolidation).
//
// Each consolidation merged two legacy tables into one with a discriminator
// + CHECK constraint. These tests verify (a) the new tables work for the
// happy path, (b) the CHECK rejects malformed inserts, (c) RLS still scopes
// correctly across personas.

describe.skipIf(!integrationEnvReady)("consolidated schemas (migrations 0010 / 0011 / 0012)", () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;

  beforeAll(async () => {
    [alice, bob, carol] = await Promise.all([
      makeTestUser("sc-alice"),
      makeTestUser("sc-bob"),
      makeTestUser("sc-carol"),
    ]);
  }, 60_000);

  afterAll(async () => {
    await deleteTestUsers([alice, bob, carol].filter(Boolean));
  }, 60_000);

  // ---------------------------------------------------------------------
  // 0010 — availabilities
  // ---------------------------------------------------------------------

  describe("availabilities", () => {
    let groupId: string;
    let matchId: string;
    let seriesId: string;
    let practiceId: string;

    beforeAll(async () => {
      // Create a group with alice as owner + bob as member.
      const admin = adminClient();
      const { data: g } = await alice.client
        .from("groups")
        .insert({ name: "Avail Test", owner_id: alice.id })
        .select("id")
        .single();
      groupId = g!.id;
      // owner row auto-added by groups_auto_add_owner.
      await admin.from("group_members").insert([
        { group_id: groupId, user_id: bob.id, roles: [] },
      ]);

      // One match + one practice to RSVP against.
      const { data: m } = await alice.client
        .from("team_matches")
        .insert({
          group_id: groupId,
          match_date: "2026-06-01",
          match_time: "18:00",
          location: "Magnuson Park",
          opponent: "Capitol Hill TC",
        })
        .select("id")
        .single();
      matchId = m!.id;

      const { data: ps } = await alice.client
        .from("practice_series")
        .insert({
          group_id: groupId,
          name: "Tuesday Drills",
          practice_time: "19:00",
          location: "Lower Woodland",
        })
        .select("id")
        .single();
      seriesId = ps!.id;

      const { data: tp } = await alice.client
        .from("team_practices")
        .insert({ series_id: seriesId, practice_date: "2026-06-02" })
        .select("id")
        .single();
      practiceId = tp!.id;
    });

    it("a member can RSVP to a match (event_kind = 'match')", async () => {
      const { data, error } = await bob.client
        .from("availabilities")
        .insert({
          event_kind: "match",
          match_id: matchId,
          user_id: bob.id,
          status: "playing",
        })
        .select("id, event_kind, match_id, practice_id")
        .single();
      expect(error).toBeNull();
      expect(data?.event_kind).toBe("match");
      expect(data?.match_id).toBe(matchId);
      expect(data?.practice_id).toBeNull();
    });

    it("a member can RSVP to a practice (event_kind = 'practice')", async () => {
      const { data, error } = await bob.client
        .from("availabilities")
        .insert({
          event_kind: "practice",
          practice_id: practiceId,
          user_id: bob.id,
          status: "playing",
        })
        .select("id, event_kind, match_id, practice_id")
        .single();
      expect(error).toBeNull();
      expect(data?.event_kind).toBe("practice");
      expect(data?.practice_id).toBe(practiceId);
      expect(data?.match_id).toBeNull();
    });

    it("CHECK rejects rows where both match_id and practice_id are set", async () => {
      const { error } = await bob.client
        .from("availabilities")
        .insert({
          event_kind: "match",
          match_id: matchId,
          practice_id: practiceId,
          user_id: bob.id,
          status: "playing",
        });
      expect(error).not.toBeNull();
    });

    it("CHECK rejects rows where neither id is set", async () => {
      const { error } = await bob.client
        .from("availabilities")
        .insert({
          event_kind: "match",
          user_id: bob.id,
          status: "playing",
        });
      expect(error).not.toBeNull();
    });

    it("non-members cannot see the group's availabilities (RLS)", async () => {
      const { data } = await carol.client
        .from("availabilities")
        .select("id")
        .eq("match_id", matchId);
      expect(data?.length ?? 0).toBe(0);
    });

    it("UNIQUE (match_id, user_id) prevents duplicate match RSVPs", async () => {
      const { error } = await bob.client
        .from("availabilities")
        .insert({
          event_kind: "match",
          match_id: matchId,
          user_id: bob.id,
          status: "maybe",
        });
      // Either explicit unique-violation or duplicate-key error.
      expect(error).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // 0011 — expense_shares with nullable user_id + guest_name
  // ---------------------------------------------------------------------

  describe("expense_shares (with guest_name)", () => {
    let chatId: string;
    let expenseId: string;

    beforeAll(async () => {
      const admin = adminClient();
      const { data: c } = await alice.client
        .from("chats")
        .insert({ name: "Doubles match", creator_id: alice.id })
        .select("id")
        .single();
      chatId = c!.id;
      await admin.from("chat_participants").insert([
        { chat_id: chatId, user_id: alice.id },
        { chat_id: chatId, user_id: bob.id },
      ]);
      const { data: e } = await alice.client
        .from("expenses")
        .insert({
          chat_id: chatId,
          payer_id: alice.id,
          amount_cents: 6000,
          description: "Court fee",
        })
        .select("id")
        .single();
      expenseId = e!.id;
    });

    it("accepts a user-bound share", async () => {
      const { data, error } = await alice.client
        .from("expense_shares")
        .insert({
          expense_id: expenseId,
          user_id: bob.id,
          amount_cents: 2000,
        })
        .select("id, user_id, guest_name")
        .single();
      expect(error).toBeNull();
      expect(data?.user_id).toBe(bob.id);
      expect(data?.guest_name).toBeNull();
    });

    it("accepts a guest share (no user_id, guest_name set)", async () => {
      const { data, error } = await alice.client
        .from("expense_shares")
        .insert({
          expense_id: expenseId,
          guest_name: "Outside player",
          amount_cents: 2000,
        })
        .select("id, user_id, guest_name")
        .single();
      expect(error).toBeNull();
      expect(data?.user_id).toBeNull();
      expect(data?.guest_name).toBe("Outside player");
    });

    it("CHECK rejects a row with neither user_id nor guest_name", async () => {
      const { error } = await alice.client
        .from("expense_shares")
        .insert({
          expense_id: expenseId,
          amount_cents: 1000,
        });
      expect(error).not.toBeNull();
    });

    it("CHECK rejects a row with both user_id and guest_name", async () => {
      const { error } = await alice.client
        .from("expense_shares")
        .insert({
          expense_id: expenseId,
          user_id: bob.id,
          guest_name: "Also bob",
          amount_cents: 1000,
        });
      expect(error).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // 0012 — post_targets
  // ---------------------------------------------------------------------

  describe("post_targets", () => {
    let groupId: string;
    let friendGroupId: string;
    let groupPostId: string;
    let fgPostId: string;

    beforeAll(async () => {
      const admin = adminClient();
      const { data: g } = await alice.client
        .from("groups")
        .insert({ name: "Targets Test", owner_id: alice.id })
        .select("id")
        .single();
      groupId = g!.id;
      // owner row auto-added by groups_auto_add_owner.
      await admin.from("group_members").insert([
        { group_id: groupId, user_id: bob.id, roles: [] },
      ]);

      const { data: fg } = await alice.client
        .from("friend_groups")
        .insert({ name: "Doubles partners", owner_id: alice.id })
        .select("id")
        .single();
      friendGroupId = fg!.id;
      await alice.client.from("friend_group_members").insert([
        { friend_group_id: friendGroupId, user_id: bob.id },
      ]);

      // Group-targeted post.
      const { data: gp } = await alice.client
        .from("posts")
        .insert({ author_id: alice.id, content: "group-targeted" })
        .select("id")
        .single();
      groupPostId = gp!.id;
      await alice.client.from("post_targets").insert({
        post_id: groupPostId,
        target_kind: "group",
        group_id: groupId,
      });

      // Friend-group-targeted post.
      const { data: fp } = await alice.client
        .from("posts")
        .insert({ author_id: alice.id, content: "fg-targeted" })
        .select("id")
        .single();
      fgPostId = fp!.id;
      await alice.client.from("post_targets").insert({
        post_id: fgPostId,
        target_kind: "friend_group",
        friend_group_id: friendGroupId,
      });
    });

    it("group member can see a group-targeted post via can_see_post", async () => {
      const { data } = await bob.client
        .from("posts")
        .select("id")
        .eq("id", groupPostId);
      expect(data?.length).toBe(1);
    });

    it("friend-group member can see a friend-group-targeted post", async () => {
      const { data } = await bob.client
        .from("posts")
        .select("id")
        .eq("id", fgPostId);
      expect(data?.length).toBe(1);
    });

    it("non-member cannot see a group-targeted post", async () => {
      const { data } = await carol.client
        .from("posts")
        .select("id")
        .eq("id", groupPostId);
      expect(data?.length ?? 0).toBe(0);
    });

    it("CHECK rejects rows where both group_id and friend_group_id are set", async () => {
      const { data: p } = await alice.client
        .from("posts")
        .insert({ author_id: alice.id, content: "test" })
        .select("id")
        .single();
      const { error } = await alice.client.from("post_targets").insert({
        post_id: p!.id,
        target_kind: "group",
        group_id: groupId,
        friend_group_id: friendGroupId,
      });
      expect(error).not.toBeNull();
    });

    it("CHECK rejects rows where the discriminator mismatches the id", async () => {
      const { data: p } = await alice.client
        .from("posts")
        .insert({ author_id: alice.id, content: "test" })
        .select("id")
        .single();
      // target_kind = 'group' but only friend_group_id set
      const { error } = await alice.client.from("post_targets").insert({
        post_id: p!.id,
        target_kind: "group",
        friend_group_id: friendGroupId,
      });
      expect(error).not.toBeNull();
    });
  });
});
