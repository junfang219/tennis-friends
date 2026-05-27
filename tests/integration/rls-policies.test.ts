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
    let groupId: string;

    beforeAll(async () => {
      // Friend-default post: no targeting, no broadcast.
      const { data: fp } = await alice.client
        .from("posts")
        .insert({ author_id: alice.id, content: "friend-visible-post" })
        .select("id")
        .single();
      friendPostId = fp!.id;

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
          { group_id: groupId, user_id: carol.id, role: "member" },
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
});
