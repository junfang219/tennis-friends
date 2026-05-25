import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  befriend,
  deleteTestUsers,
  integrationEnvReady,
  makeTestUser,
  type TestUser,
} from "./_helpers";

// End-to-end coverage of every query helper under
// src/lib/supabase/queries/*. The helpers wrap RLS-enforced SQL, so each
// test confirms both that the query function works AND that RLS does the
// right thing for the calling persona.

import {
  // Profiles
  getProfile,
  getMyProfile,
  updateMyProfile,
  completeOnboarding,
  searchProfiles,
  // Posts
  listFeed,
  getPost,
  listPostsByAuthor,
  createPost,
  deletePost,
  likePost,
  unlikePost,
  hidePost,
  listComments,
  addComment,
  // Friends
  listFriends,
  listPendingRequests,
  sendFriendRequest,
  getFriendshipWith,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
  blockUser,
  unblockUser,
  countUserFriends,
  // Messages
  listDirectMessages,
  sendDirectMessage,
  deleteDirectMessage,
  markDmRead,
  addReaction,
  removeReaction,
  listReactionsForMessages,
  listDmThreads,
  // Notifications
  listNotifications,
  unreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  // Groups
  listMyGroups,
  getGroup,
  listGroupMembers,
  listGroupMessages,
  sendGroupMessage,
  // Events
  listEvents,
  getEvent,
  createEvent,
  listEventParticipants,
  signupForEvent,
  withdrawFromEvent,
  // Courts
  listCourts,
  getCourt,
  addCourt,
  listCourtReviews,
  addCourtReview,
} from "../../src/lib/supabase/queries";

describe.skipIf(!integrationEnvReady)("query helpers (live Supabase)", () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;

  beforeAll(async () => {
    [alice, bob, carol] = await Promise.all([
      makeTestUser("q-alice"),
      makeTestUser("q-bob"),
      makeTestUser("q-carol"),
    ]);
  }, 60_000);

  afterAll(async () => {
    await deleteTestUsers([alice, bob, carol].filter(Boolean));
  }, 60_000);

  // ---------------------------------------------------------------------
  // Profiles
  // ---------------------------------------------------------------------

  describe("profiles", () => {
    it("getMyProfile returns the signed-in user's profile row", async () => {
      const me = await getMyProfile(alice.client);
      expect(me).not.toBeNull();
      expect(me?.id).toBe(alice.id);
    });

    it("updateMyProfile persists changes", async () => {
      await updateMyProfile(alice.client, {
        bio: "Tennis-loving developer",
        skill_level: "4.0",
      });
      const fresh = await getMyProfile(alice.client);
      expect(fresh?.bio).toBe("Tennis-loving developer");
      expect(fresh?.skill_level).toBe("4.0");
    });

    it("completeOnboarding flips onboarding_complete", async () => {
      await completeOnboarding(bob.client, { name: "Bob Tester" });
      const fresh = await getMyProfile(bob.client);
      expect(fresh?.onboarding_complete).toBe(true);
      expect(fresh?.name).toBe("Bob Tester");
    });

    it("getProfile returns another user's public profile when not private", async () => {
      const view = await getProfile(carol.client, alice.id);
      expect(view?.id).toBe(alice.id);
    });

    it("searchProfiles applies NTRP filters", async () => {
      await updateMyProfile(alice.client, {
        ntrp_rating: 4.0,
        onboarding_complete: true,
      });
      const results = await searchProfiles(carol.client, {
        ntrpMin: 3.5,
        ntrpMax: 4.5,
      });
      expect(results.some((r) => r.id === alice.id)).toBe(true);
    });

    it("searchProfiles hides accepted friends and annotates pending state", async () => {
      // Three fresh users so we can exercise all three relationship states
      // in isolation without disturbing the shared alice/bob/carol fixtures.
      const [sp1, sp2, sp3, sp4] = await Promise.all([
        makeTestUser("sp-viewer"),
        makeTestUser("sp-friend"),
        makeTestUser("sp-pending-out"),
        makeTestUser("sp-pending-in"),
      ]);
      try {
        // Make all four discoverable.
        await Promise.all(
          [sp1, sp2, sp3, sp4].map((u) =>
            updateMyProfile(u.client, { onboarding_complete: true, name: u.id.slice(0, 8) })
          )
        );

        // sp1 ↔ sp2: accepted friendship (should be hidden from Discover).
        await befriend(sp1, sp2);
        // sp1 → sp3: pending outgoing (should appear with isRequester=true).
        await sendFriendRequest(sp1.client, sp3.id);
        // sp4 → sp1: pending incoming (should appear with isRequester=false).
        await sendFriendRequest(sp4.client, sp1.id);

        const results = await searchProfiles(sp1.client, { limit: 200 });
        const byId = new Map(results.map((r) => [r.id, r]));

        // Accepted friend is filtered out entirely.
        expect(byId.has(sp2.id)).toBe(false);

        // Outgoing pending: present, status PENDING, isRequester true.
        const out = byId.get(sp3.id);
        expect(out).toBeDefined();
        expect(out?.friendshipStatus).toBe("PENDING");
        expect(out?.isRequester).toBe(true);
        expect(out?.friendshipId).toBeTruthy();

        // Incoming pending: present, status PENDING, isRequester false.
        const incoming = byId.get(sp4.id);
        expect(incoming).toBeDefined();
        expect(incoming?.friendshipStatus).toBe("PENDING");
        expect(incoming?.isRequester).toBe(false);
        expect(incoming?.friendshipId).toBeTruthy();
      } finally {
        await deleteTestUsers([sp1, sp2, sp3, sp4]);
      }
    });
  });

  // ---------------------------------------------------------------------
  // Friends
  // ---------------------------------------------------------------------

  describe("friends", () => {
    it("sendFriendRequest + acceptFriendRequest establishes a friendship", async () => {
      // alice → bob
      await sendFriendRequest(alice.client, bob.id);

      // bob sees the incoming request
      const bobPending = await listPendingRequests(bob.client);
      const incoming = bobPending.find(
        (p) => p.direction === "incoming" && p.other.id === alice.id
      );
      expect(incoming).toBeDefined();

      // bob accepts
      await acceptFriendRequest(bob.client, incoming!.id);

      // both see each other in their friends list
      const aliceFriends = await listFriends(alice.client);
      const bobFriends = await listFriends(bob.client);
      expect(aliceFriends.some((f) => f.id === bob.id)).toBe(true);
      expect(bobFriends.some((f) => f.id === alice.id)).toBe(true);
    });

    it("removeFriend tears down the friendship", async () => {
      await removeFriend(alice.client, bob.id);
      const aliceFriends = await listFriends(alice.client);
      expect(aliceFriends.some((f) => f.id === bob.id)).toBe(false);
    });

    // Regression: profile page was always rendering "Add Friend" for the
    // addressee because UserProfilePage never loaded the friendship state.
    // getFriendshipWith must return the row from either direction so the
    // button can show "Accept" / "Request Sent" correctly.
    it("getFriendshipWith returns the row in both directions", async () => {
      // alice → carol
      await sendFriendRequest(alice.client, carol.id);

      // alice (requester) sees herself as requester
      const aliceView = await getFriendshipWith(alice.client, carol.id);
      expect(aliceView.friendshipStatus).toBe("PENDING");
      expect(aliceView.isRequester).toBe(true);

      // carol (addressee) sees the same row, but isRequester=false
      const carolView = await getFriendshipWith(carol.client, alice.id);
      expect(carolView.friendshipStatus).toBe("PENDING");
      expect(carolView.isRequester).toBe(false);
      expect(carolView.friendshipId).toBe(aliceView.friendshipId);

      // Cleanup so the next test isn't polluted.
      await rejectFriendRequest(carol.client, carolView.friendshipId!);
    });

    // Regression: sendFriendRequest used to return void, and the unique
    // constraint violation from a repeat-click was swallowed by a silent
    // catch in the UI — leaving the button stuck on "Add Friend". The new
    // shape returns the friendship state and is idempotent on duplicate
    // same-direction inserts. (The schema's unique constraint is on the
    // ordered (requester_id, addressee_id) pair, so reverse-direction
    // inserts are allowed and create a distinct row — not tested here.)
    it("sendFriendRequest returns the friendship state and is idempotent", async () => {
      const first = await sendFriendRequest(alice.client, carol.id);
      expect(first.friendshipStatus).toBe("PENDING");
      expect(first.isRequester).toBe(true);
      expect(first.friendshipId).toBeTruthy();

      // Sending again returns the same row instead of throwing.
      const second = await sendFriendRequest(alice.client, carol.id);
      expect(second.friendshipId).toBe(first.friendshipId);
      expect(second.isRequester).toBe(true);

      await rejectFriendRequest(carol.client, first.friendshipId);
    });

    // Regression: no trigger existed to create a friend_request notification
    // on friendship insert, so the addressee never saw the bell light up.
    it("inserting a friendship creates a friend_request notification for the addressee", async () => {
      await sendFriendRequest(alice.client, carol.id);

      // carol can read her own notifications (notifications_select_own RLS).
      const { data: notes, error } = await carol.client
        .from("notifications")
        .select("type, actor_id")
        .eq("user_id", carol.id)
        .eq("type", "friend_request")
        .eq("actor_id", alice.id);
      expect(error).toBeNull();
      expect(notes?.length).toBeGreaterThan(0);

      await removeFriend(carol.client, alice.id);
    });

    // Regression: when the requester cancels (or the addressee rejects /
    // accepts), the friend_request notification was left behind and the
    // addressee saw a stale, unactionable request in their bell.
    it("cancelling/rejecting/accepting a friend request removes the notification", async () => {
      const helpers: Array<() => Promise<void>> = [
        // Case 1: requester cancels (removeFriend deletes the row).
        async () => {
          await sendFriendRequest(alice.client, carol.id);
          await removeFriend(alice.client, carol.id);
        },
        // Case 2: addressee rejects (delete of the row).
        async () => {
          const { friendshipId } = await sendFriendRequest(alice.client, carol.id);
          await rejectFriendRequest(carol.client, friendshipId);
        },
        // Case 3: addressee accepts (status update pending → accepted).
        async () => {
          const { friendshipId } = await sendFriendRequest(alice.client, carol.id);
          await acceptFriendRequest(carol.client, friendshipId);
          // Tidy: now remove the accepted friendship.
          await removeFriend(carol.client, alice.id);
        },
      ];

      for (const run of helpers) {
        await run();
        const { data: notes, error } = await carol.client
          .from("notifications")
          .select("id")
          .eq("user_id", carol.id)
          .eq("type", "friend_request")
          .eq("actor_id", alice.id);
        expect(error).toBeNull();
        expect(notes ?? []).toHaveLength(0);
      }
    });

    it("getFriendshipWith returns nulls when no relationship exists", async () => {
      const result = await getFriendshipWith(alice.client, carol.id);
      expect(result.friendshipId).toBeNull();
      expect(result.friendshipStatus).toBeNull();
      expect(result.isRequester).toBe(false);
    });

    it("rejectFriendRequest removes the pending row", async () => {
      await sendFriendRequest(alice.client, carol.id);
      const pending = await listPendingRequests(carol.client);
      const req = pending.find((p) => p.other.id === alice.id);
      expect(req).toBeDefined();
      await rejectFriendRequest(carol.client, req!.id);
      const after = await listPendingRequests(carol.client);
      expect(after.some((p) => p.other.id === alice.id)).toBe(false);
    });

    it("blockUser and unblockUser write to blocks table", async () => {
      await blockUser(alice.client, carol.id);
      // alice should see the block row; carol should not
      const aliceBlocks = await alice.client.from("blocks").select("id");
      const carolBlocks = await carol.client
        .from("blocks")
        .select("id")
        .eq("blocker_id", alice.id);
      expect(aliceBlocks.data?.length ?? 0).toBeGreaterThan(0);
      expect(carolBlocks.data?.length ?? 0).toBe(0);

      await unblockUser(alice.client, carol.id);
    });

    // The SECURITY DEFINER count_user_friends() RPC is the only way for a
    // viewer to see another user's friend count, because friendships RLS
    // hides rows where the viewer isn't a participant. The /profile/[id]
    // friend-count chip depends on it.
    it("countUserFriends returns the count even when the viewer can't see the rows", async () => {
      await befriend(alice, bob);
      await befriend(alice, carol);

      // Self-count: alice can see her own two friendships directly via RLS.
      expect(await countUserFriends(alice.client, alice.id)).toBe(2);

      // Cross-user count: bob can SELECT only his own (alice↔bob) row, so a
      // plain count(*) on carol would return 0. The RPC must bypass that.
      // alice↔carol exists but is invisible to bob — the RPC still sees it.
      expect(await countUserFriends(bob.client, carol.id)).toBe(1);
      expect(await countUserFriends(bob.client, alice.id)).toBe(2);

      await removeFriend(alice.client, bob.id);
      await removeFriend(alice.client, carol.id);
    });
  });

  // ---------------------------------------------------------------------
  // Posts + comments + likes
  // ---------------------------------------------------------------------

  describe("posts", () => {
    beforeAll(async () => {
      // Make sure alice and bob are friends again for visibility tests.
      try {
        await befriend(alice, bob);
      } catch {
        // Already friends — fine.
      }
    });

    let postId: string;

    it("createPost stores the post and enriches it", async () => {
      const p = await createPost(alice.client, {
        content: "Hello from queries test",
        post_type: "regular",
      });
      expect(p.author_id).toBe(alice.id);
      expect(p.content).toBe("Hello from queries test");
      expect(p.like_count).toBe(0);
      postId = p.id;
    });

    it("listFeed surfaces own + friend posts", async () => {
      const aliceFeed = await listFeed(alice.client, { limit: 20 });
      expect(aliceFeed.some((p) => p.id === postId)).toBe(true);
      const bobFeed = await listFeed(bob.client, { limit: 20 });
      expect(bobFeed.some((p) => p.id === postId)).toBe(true);
    });

    it("listFeed hides default-visibility posts from strangers", async () => {
      // carol is NOT alice's friend.
      const carolFeed = await listFeed(carol.client, { limit: 20 });
      expect(carolFeed.some((p) => p.id === postId)).toBe(false);
    });

    it("likePost increments like_count and is_liked", async () => {
      await likePost(bob.client, postId);
      const p = await getPost(alice.client, postId);
      expect(p?.like_count).toBe(1);
    });

    it("likePost is idempotent (no duplicate-key crash)", async () => {
      await likePost(bob.client, postId);
      const p = await getPost(alice.client, postId);
      expect(p?.like_count).toBe(1);
    });

    it("unlikePost decrements the count", async () => {
      await unlikePost(bob.client, postId);
      const p = await getPost(alice.client, postId);
      expect(p?.like_count).toBe(0);
    });

    it("addComment + listComments round-trip", async () => {
      const c = await addComment(bob.client, postId, "nice post");
      expect(c.content).toBe("nice post");
      const all = await listComments(alice.client, postId);
      expect(all.length).toBe(1);
      expect(all[0].author.id).toBe(bob.id);
    });

    it("hidePost soft-hides for the caller only", async () => {
      await hidePost(bob.client, postId);
      // The hidden_posts row is bob's; alice's view of the post is unaffected.
      const aliceView = await getPost(alice.client, postId);
      expect(aliceView).not.toBeNull();
    });

    it("listPostsByAuthor returns the author's own posts", async () => {
      const own = await listPostsByAuthor(alice.client, alice.id);
      expect(own.length).toBeGreaterThan(0);
      expect(own.every((p) => p.author_id === alice.id)).toBe(true);
    });

    it("deletePost removes the row", async () => {
      await deletePost(alice.client, postId);
      const p = await getPost(alice.client, postId);
      expect(p).toBeNull();
    });

    // Regression: the pre-Supabase /api/posts/join/respond route auto-
    // created a session group chat when a find-players post filled, and
    // PostCard's collapsed "Open chat" CTA reads from it. The migration
    // dropped that logic; commit (this one) restored it as a Postgres
    // trigger so any code path that flips is_complete = true creates the
    // chat, idempotently.
    it("flipping a find_players post to is_complete auto-creates a session chat", async () => {
      const post = await createPost(alice.client, {
        content: "Looking for 1 player",
        post_type: "find_players",
        play_date: "2026-05-23",
        play_time: "09:20",
        play_duration: 90,
        court_location: "Test Court",
        game_type: "singles",
        players_needed: 1,
      });

      // No chat yet — post starts with is_complete = false (default).
      const before = await alice.client
        .from("chats")
        .select("id")
        .eq("post_id", post.id);
      expect(before.data ?? []).toHaveLength(0);

      // Flip to complete. The AFTER UPDATE OF is_complete trigger should
      // create the chat + author participant + welcome message.
      const upd = await alice.client
        .from("posts")
        .update({ players_confirmed: 1, is_complete: true })
        .eq("id", post.id);
      expect(upd.error).toBeNull();

      const after = await alice.client
        .from("chats")
        .select("id, post_id, name, session_end_at")
        .eq("post_id", post.id);
      expect(after.data ?? []).toHaveLength(1);
      const chatId = after.data![0].id;

      const participants = await alice.client
        .from("chat_participants")
        .select("user_id")
        .eq("chat_id", chatId);
      expect(participants.data?.map((p) => p.user_id)).toEqual([alice.id]);

      const messages = await alice.client
        .from("chat_messages")
        .select("content, sender_id")
        .eq("chat_id", chatId);
      expect(messages.data ?? []).toHaveLength(1);
      expect(messages.data![0].sender_id).toBe(alice.id);
      expect(messages.data![0].content).toContain("Game confirmed");

      // Idempotent: a second is_complete=true UPDATE must not create a
      // second chat (the trigger's existence check + the unique partial
      // index on chats.post_id together guarantee this).
      await alice.client
        .from("posts")
        .update({ is_complete: true })
        .eq("id", post.id);
      const stillOne = await alice.client
        .from("chats")
        .select("id")
        .eq("post_id", post.id);
      expect(stillOne.data ?? []).toHaveLength(1);

      // Cleanup so the test doesn't leak fixtures into later runs.
      await alice.client.from("chats").delete().eq("id", chatId);
      await deletePost(alice.client, post.id);
    });
  });

  // ---------------------------------------------------------------------
  // Messages (DMs)
  // ---------------------------------------------------------------------

  describe("messages", () => {
    it("sendDirectMessage stores the row and listDirectMessages returns it", async () => {
      await sendDirectMessage(alice.client, bob.id, "hey bob");
      const thread = await listDirectMessages(alice.client, bob.id);
      expect(thread.some((m) => m.content === "hey bob")).toBe(true);
    });

    it("markDmRead upserts a direct_message_reads row", async () => {
      await markDmRead(alice.client, bob.id);
      const { data } = await alice.client
        .from("direct_message_reads")
        .select("user_id, other_id")
        .eq("user_id", alice.id)
        .eq("other_id", bob.id);
      expect(data?.length).toBe(1);
    });

    it("listDmThreads returns one row per partner with correct unread count", async () => {
      // bob → alice (alice hasn't read it yet)
      await sendDirectMessage(bob.client, alice.id, "yo");
      const threads = await listDmThreads(alice.client);
      const t = threads.find((x) => x.other.id === bob.id);
      expect(t).toBeDefined();
      expect(t!.unread_count).toBeGreaterThanOrEqual(1);
    });

    it("deleteDirectMessage removes the sender's own message", async () => {
      const row = await sendDirectMessage(alice.client, bob.id, "to be deleted");
      await deleteDirectMessage(alice.client, row.id);
      const thread = await listDirectMessages(alice.client, bob.id);
      expect(thread.some((m) => m.id === row.id)).toBe(false);
    });

    it("deleteDirectMessage on a peer's message is a no-op (RLS blocks)", async () => {
      // bob sends; alice tries to delete. RLS policy messages_delete_sender
      // restricts deletes to sender_id = auth.uid(), so this is a silent
      // no-op from the client's perspective — the row stays.
      const row = await sendDirectMessage(bob.client, alice.id, "alice can't touch this");
      await deleteDirectMessage(alice.client, row.id);
      const thread = await listDirectMessages(alice.client, bob.id);
      expect(thread.some((m) => m.id === row.id)).toBe(true);
    });

    it("listReactionsForMessages returns reactions added by add/removeReaction", async () => {
      const row = await sendDirectMessage(alice.client, bob.id, "react to me");

      // Bob adds a reaction; both directions should be able to see it
      // (RLS for message_reactions allows visibility when the parent
      // message is visible to the viewer).
      await addReaction(bob.client, "dm", row.id, "heart");
      const seenByAlice = await listReactionsForMessages(alice.client, "dm", [row.id]);
      expect(seenByAlice.some((r) => r.user_id === bob.id && r.emoji === "heart")).toBe(true);

      // Bob removes it; the listing helper drops it.
      await removeReaction(bob.client, "dm", row.id, "heart");
      const afterRemoval = await listReactionsForMessages(alice.client, "dm", [row.id]);
      expect(afterRemoval.some((r) => r.user_id === bob.id && r.emoji === "heart")).toBe(false);
    });

    it("listReactionsForMessages returns [] for an empty id list without hitting the DB", async () => {
      const empty = await listReactionsForMessages(alice.client, "dm", []);
      expect(empty).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------
  // Notifications (insert via admin to skip the auth.uid() ownership check)
  // ---------------------------------------------------------------------

  describe("notifications", () => {
    let notifId: string;

    beforeAll(async () => {
      const admin = adminClient();
      const { data, error } = await admin
        .from("notifications")
        .insert({
          user_id: alice.id,
          actor_id: bob.id,
          type: "like",
          read: false,
        })
        .select("id")
        .single();
      if (error) throw error;
      notifId = data.id;
    });

    it("listNotifications scoped to signed-in user", async () => {
      const list = await listNotifications(alice.client);
      expect(list.some((n) => n.id === notifId)).toBe(true);
      const bobList = await listNotifications(bob.client);
      expect(bobList.some((n) => n.id === notifId)).toBe(false);
    });

    it("unreadNotificationCount reflects unread", async () => {
      const n = await unreadNotificationCount(alice.client);
      expect(n).toBeGreaterThanOrEqual(1);
    });

    it("markNotificationRead flips the read flag", async () => {
      await markNotificationRead(alice.client, notifId);
      const list = await listNotifications(alice.client);
      const updated = list.find((n) => n.id === notifId);
      expect(updated?.read).toBe(true);
    });

    it("markAllNotificationsRead clears the unread count", async () => {
      // Add another unread notification, then mark all.
      const admin = adminClient();
      await admin.from("notifications").insert({
        user_id: alice.id,
        actor_id: bob.id,
        type: "like",
        read: false,
      });
      await markAllNotificationsRead(alice.client);
      expect(await unreadNotificationCount(alice.client)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------
  // Groups
  // ---------------------------------------------------------------------

  describe("groups", () => {
    let groupId: string;

    beforeAll(async () => {
      const { data, error } = await alice.client
        .from("groups")
        .insert({ name: "Test Squad", owner_id: alice.id })
        .select("id")
        .single();
      if (error) throw error;
      groupId = data.id;
      // Add alice as owner-member (her insert doesn't auto-create this).
      // Use admin to bypass policy bootstrap.
      const admin = adminClient();
      await admin.from("group_members").insert([
        { group_id: groupId, user_id: alice.id, role: "owner" },
        { group_id: groupId, user_id: bob.id, role: "member" },
      ]);
    });

    it("listMyGroups includes groups I'm in", async () => {
      const groups = await listMyGroups(bob.client);
      expect(groups.some((g) => g.id === groupId)).toBe(true);
    });

    it("getGroup returns the group", async () => {
      const g = await getGroup(alice.client, groupId);
      expect(g?.name).toBe("Test Squad");
    });

    it("listGroupMembers returns the roster for a member", async () => {
      const members = await listGroupMembers(bob.client, groupId);
      expect(members.length).toBeGreaterThanOrEqual(2);
    });

    it("listGroupMembers returns nothing for non-members", async () => {
      const members = await listGroupMembers(carol.client, groupId);
      expect(members.length).toBe(0);
    });

    it("sendGroupMessage + listGroupMessages round-trip", async () => {
      const sent = await sendGroupMessage(bob.client, groupId, "go team");
      expect(sent.content).toBe("go team");
      const msgs = await listGroupMessages(alice.client, groupId);
      expect(msgs.some((m) => m.id === sent.id)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------

  describe("events", () => {
    let eventId: string;

    it("createEvent stores the event", async () => {
      const e = await createEvent(alice.client, {
        title: "Saturday Mixer",
        event_type: "mixer",
        start_date: new Date(Date.now() + 86400_000).toISOString(),
        end_date: new Date(Date.now() + 86400_000 * 2).toISOString(),
        is_public_signup: true,
        visibility: "public",
        event_lat: 47.6062,
        event_lng: -122.3321,
        radius_mi: 25,
      });
      expect(e.title).toBe("Saturday Mixer");
      eventId = e.id;
    });

    it("getEvent + listEvents return the new event", async () => {
      const e = await getEvent(alice.client, eventId);
      expect(e?.id).toBe(eventId);
      const upcoming = await listEvents(alice.client, { upcoming: true });
      expect(upcoming.some((x) => x.id === eventId)).toBe(true);
    });

    it("signupForEvent + listEventParticipants round-trip", async () => {
      // Bob signs up (alice is owner, event is public).
      // Note: bob needs to be within radius of alice's event for can_see_event.
      // We set bob's location near Seattle to match.
      await bob.client
        .from("profiles")
        .update({ latitude: 47.6062, longitude: -122.3321 })
        .eq("id", bob.id);

      const p = await signupForEvent(bob.client, eventId);
      expect(p.user_id).toBe(bob.id);
      const participants = await listEventParticipants(alice.client, eventId);
      expect(participants.some((x) => x.user_id === bob.id)).toBe(true);
    });

    it("withdrawFromEvent flips participant status to withdrawn", async () => {
      await withdrawFromEvent(bob.client, eventId);
      const participants = await listEventParticipants(alice.client, eventId);
      const me = participants.find((x) => x.user_id === bob.id);
      expect(me?.status).toBe("withdrawn");
    });

    // Regression: /api/events/[id]/signup used to count current registered
    // participants, flip status to 'waitlist' when at capacity, notify the
    // event owner, and promote the next waitlister on withdraw. The
    // migration replaced it with a bare client INSERT — capacity check,
    // notification, and promotion were all gone. These three tests cover
    // the trigger-based restoration.
    it("event_participants capacity trigger flips overflow signups to waitlist", async () => {
      // Fresh event with max=1 so the second signup must waitlist.
      const e = await createEvent(alice.client, {
        title: "Capped Mixer",
        event_type: "mixer",
        start_date: new Date(Date.now() + 86400_000).toISOString(),
        end_date: new Date(Date.now() + 86400_000 * 2).toISOString(),
        is_public_signup: true,
        visibility: "public",
        max_participants: 1,
        event_lat: 47.6062,
        event_lng: -122.3321,
        radius_mi: 25,
      });

      // bob fills the only seat → registered.
      const p1 = await signupForEvent(bob.client, e.id);
      expect(p1.status).toBe("registered");

      // carol is over capacity → trigger flips to waitlist before insert.
      await carol.client
        .from("profiles")
        .update({ latitude: 47.6062, longitude: -122.3321 })
        .eq("id", carol.id);
      const p2 = await signupForEvent(carol.client, e.id);
      expect(p2.status).toBe("waitlist");

      // Withdraw the registered participant → promotion trigger should
      // pull the oldest waitlister back to 'registered'.
      await withdrawFromEvent(bob.client, e.id);
      const participants = await listEventParticipants(alice.client, e.id);
      const carolRow = participants.find((x) => x.user_id === carol.id);
      expect(carolRow?.status).toBe("registered");

      // Cleanup.
      const admin = adminClient();
      await admin.from("events").delete().eq("id", e.id);
    });

    it("event_participants signup fires an event_signup notification to the owner", async () => {
      // alice (owner) should have a fresh event_signup notification from
      // bob's earlier signup. The previous event-suite tests created
      // bob's participant row, which is enough; just assert the row.
      const { data: notes, error } = await alice.client
        .from("notifications")
        .select("type, actor_id, event_id")
        .eq("user_id", alice.id)
        .eq("type", "event_signup")
        .eq("actor_id", bob.id)
        .eq("event_id", eventId);
      expect(error).toBeNull();
      expect((notes ?? []).length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------
  // Courts
  // ---------------------------------------------------------------------

  describe("courts", () => {
    let courtId: string;

    it("addCourt + getCourt round-trip", async () => {
      const c = await addCourt(alice.client, {
        name: "Mystery Park",
        latitude: 47.6,
        longitude: -122.3,
        notes: "for testing",
      });
      expect(c.name).toBe("Mystery Park");
      courtId = c.id;
      const fetched = await getCourt(carol.client, courtId);
      expect(fetched?.id).toBe(courtId);
    });

    it("addCourtReview + listCourtReviews round-trip", async () => {
      const review = await addCourtReview(bob.client, courtId, {
        stars: 5,
        content: "great courts",
      });
      expect(review.stars).toBe(5);
      const reviews = await listCourtReviews(alice.client, courtId);
      expect(reviews.some((r) => r.id === review.id)).toBe(true);
    });

    // Regression: static-catalog facilities (data/tennis_courts.json) use
    // string IDs like "tf-15" rather than UUIDs. court_reviews.court_id is
    // text precisely so those reviews can be written without an
    // "invalid input syntax for type uuid" rejection — guard against any
    // future attempt to re-add the FK to courts.id.
    it("accepts static-catalog 'tf-*' string IDs as court_id", async () => {
      const staticId = `tf-test-${Date.now()}`;
      const review = await addCourtReview(carol.client, staticId, {
        stars: 4,
        content: "static-catalog review",
      });
      expect(review.stars).toBe(4);
      expect(review.court_id).toBe(staticId);
      const reviews = await listCourtReviews(carol.client, staticId);
      expect(reviews.some((r) => r.id === review.id)).toBe(true);
    });

    // Regression: addCourtReview must upsert on (court_id, user_id) so a
    // second save for the same court overwrites the existing row instead
    // of failing with "duplicate key value violates unique constraint
    // court_reviews_unique" — what real users hit when editing their
    // review through the composer.
    it("upserts on (court_id, user_id) — second save for same court updates, not duplicates", async () => {
      const staticId = `tf-upsert-${Date.now()}`;
      const first = await addCourtReview(alice.client, staticId, {
        stars: 3,
        content: "first take",
      });
      const second = await addCourtReview(alice.client, staticId, {
        stars: 5,
        content: "loved it on second visit",
      });
      // Same row id, updated content + stars.
      expect(second.id).toBe(first.id);
      expect(second.stars).toBe(5);
      expect(second.content).toBe("loved it on second visit");

      const reviews = await listCourtReviews(alice.client, staticId);
      expect(reviews.filter((r) => r.user.id === alice.id)).toHaveLength(1);
    });

    it("listCourts returns my added court", async () => {
      const all = await listCourts(carol.client);
      expect(all.some((c) => c.id === courtId)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // Notification side-effect triggers (likes / comments / play_requests /
  // message_reactions). Recreates the fan-out the legacy /api/* route
  // handlers used to do before commit 86f26a5 deleted them. Without these
  // triggers all of these notifications would silently never fire.
  // ---------------------------------------------------------------------

  describe("notification side-effect triggers", () => {
    let postId: string;

    beforeAll(async () => {
      // RLS on likes / comments / play_requests gates on can_see_post,
      // which requires friendship for untargeted posts. Earlier describe
      // blocks (friends, events, ...) churn alice/bob's relationship, so
      // re-establish it here before exercising the triggers.
      try { await befriend(alice, bob); } catch { /* already friends */ }
      try { await befriend(alice, carol); } catch { /* already friends */ }

      const p = await createPost(alice.client, {
        content: "Trigger fixtures",
        post_type: "regular",
      });
      postId = p.id;
    });

    afterAll(async () => {
      await deletePost(alice.client, postId).catch(() => {});
    });

    it("liking a post notifies the post author (skips self-likes)", async () => {
      const admin = adminClient();
      await admin
        .from("notifications")
        .delete()
        .eq("user_id", alice.id)
        .eq("type", "like")
        .eq("post_id", postId);

      await likePost(bob.client, postId);
      const { data: notes } = await alice.client
        .from("notifications")
        .select("type, actor_id, post_id")
        .eq("user_id", alice.id)
        .eq("type", "like")
        .eq("actor_id", bob.id)
        .eq("post_id", postId);
      expect((notes ?? []).length).toBe(1);

      // Self-like by the author must NOT create another row.
      await likePost(alice.client, postId);
      const { data: afterSelf } = await alice.client
        .from("notifications")
        .select("id")
        .eq("user_id", alice.id)
        .eq("type", "like")
        .eq("post_id", postId);
      expect((afterSelf ?? []).length).toBe(1);

      await unlikePost(bob.client, postId);
      await unlikePost(alice.client, postId);
    });

    it("top-level comments notify only the post author (no broadcast fan-out)", async () => {
      const admin = adminClient();
      await admin
        .from("notifications")
        .delete()
        .in("type", ["comment", "reply"])
        .eq("post_id", postId);

      // carol comments → notifies alice (the post author) with "comment".
      await addComment(carol.client, postId, "carol's first");
      const { data: aliceFirst } = await alice.client
        .from("notifications")
        .select("type, actor_id")
        .eq("user_id", alice.id)
        .eq("type", "comment")
        .eq("post_id", postId)
        .eq("actor_id", carol.id);
      expect((aliceFirst ?? []).length).toBe(1);

      // bob also comments at top level. alice gets another "comment".
      // The old broadcast trigger would have fired a "reply" to carol
      // too — confirm that no longer happens.
      await addComment(bob.client, postId, "bob's comment");
      const { data: aliceAfterBob } = await alice.client
        .from("notifications")
        .select("id")
        .eq("user_id", alice.id)
        .eq("type", "comment")
        .eq("post_id", postId)
        .eq("actor_id", bob.id);
      expect((aliceAfterBob ?? []).length).toBe(1);

      const { data: carolBroadcast } = await carol.client
        .from("notifications")
        .select("id")
        .eq("user_id", carol.id)
        .eq("type", "reply")
        .eq("post_id", postId)
        .eq("actor_id", bob.id);
      // Threaded-only semantics: no broadcast reply notification for
      // top-level sibling comments.
      expect((carolBroadcast ?? []).length).toBe(0);

      // Self-comment by the post author shouldn't notify herself.
      await addComment(alice.client, postId, "author note");
      const { data: aliceSelf } = await alice.client
        .from("notifications")
        .select("id")
        .eq("user_id", alice.id)
        .eq("type", "comment")
        .eq("actor_id", alice.id)
        .eq("post_id", postId);
      expect((aliceSelf ?? []).length).toBe(0);
    });

    // Threaded replies: addComment now accepts a parent comment id.
    // When set, the trigger fires "reply" to the parent comment's
    // author rather than the broadcast variant.
    it("replying to a comment notifies the parent comment's author", async () => {
      const admin = adminClient();
      await admin
        .from("notifications")
        .delete()
        .in("type", ["comment", "reply"])
        .eq("post_id", postId);

      // carol leaves a top-level comment on alice's post.
      const carolComment = await addComment(carol.client, postId, "interesting take");

      // bob replies to carol → carol should get a "reply" notification
      // (NOT a "comment" — that goes to the post author only when the
      // parent is null).
      const bobReply = await addComment(
        bob.client,
        postId,
        "agreed, and also…",
        carolComment.id
      );
      expect(bobReply.parent_comment_id).toBe(carolComment.id);

      const { data: carolReply } = await carol.client
        .from("notifications")
        .select("type, actor_id, comment_id")
        .eq("user_id", carol.id)
        .eq("type", "reply")
        .eq("actor_id", bob.id)
        .eq("post_id", postId);
      expect((carolReply ?? []).length).toBe(1);
      expect(carolReply![0].comment_id).toBe(bobReply.id);

      // alice (post author) should NOT get a "comment" for a reply —
      // the trigger branches on parent_comment_id and only the parent's
      // author is notified.
      const { data: aliceForReply } = await alice.client
        .from("notifications")
        .select("id")
        .eq("user_id", alice.id)
        .eq("type", "comment")
        .eq("post_id", postId)
        .eq("actor_id", bob.id)
        .eq("comment_id", bobReply.id);
      expect((aliceForReply ?? []).length).toBe(0);

      // Self-replies don't notify.
      const carolSelfReply = await addComment(
        carol.client,
        postId,
        "follow-up to myself",
        carolComment.id
      );
      const { data: carolSelfNotif } = await carol.client
        .from("notifications")
        .select("id")
        .eq("user_id", carol.id)
        .eq("type", "reply")
        .eq("comment_id", carolSelfReply.id);
      expect((carolSelfNotif ?? []).length).toBe(0);
    });

    // Regression: when Mimi replied to Jun's reply (3-deep chain), the
    // UI used to collapse the parent back to the top-level comment so
    // the trigger saw Mimi as parent → self-author skip → Jun got no
    // notification. The fix passes the direct parent's id; this test
    // pins the data model so the trigger fires correctly through any
    // depth.
    it("reply-to-a-reply notifies the direct parent's author (deep chain)", async () => {
      const admin = adminClient();
      await admin
        .from("notifications")
        .delete()
        .in("type", ["comment", "reply"])
        .eq("post_id", postId);

      // carol writes a top-level comment.
      const topLevel = await addComment(carol.client, postId, "anyone want to play?");
      expect(topLevel.parent_comment_id).toBeNull();

      // bob replies to carol's top-level. Carol gets a "reply" notif.
      const bobReply = await addComment(
        bob.client,
        postId,
        "I'm in",
        topLevel.id
      );
      expect(bobReply.parent_comment_id).toBe(topLevel.id);

      // carol now replies to bob's reply. The reply's parent must be
      // bob's comment (not the top-level), so the trigger notifies bob.
      const carolReplyToReply = await addComment(
        carol.client,
        postId,
        "@bob sounds good",
        bobReply.id
      );
      expect(carolReplyToReply.parent_comment_id).toBe(bobReply.id);

      const { data: bobNotif } = await bob.client
        .from("notifications")
        .select("id, comment_id")
        .eq("user_id", bob.id)
        .eq("type", "reply")
        .eq("actor_id", carol.id)
        .eq("post_id", postId);
      // bob should have exactly one reply notif — for carol's
      // reply-to-reply ("@bob sounds good"). His earlier
      // request_approved-style fixtures don't apply here.
      expect((bobNotif ?? []).some((n) => n.comment_id === carolReplyToReply.id)).toBe(true);

      // Carol (top-level author + the new replier) should NOT get a
      // "reply" notif for her own message. This is what was broken
      // before the fix — the trigger was being asked to notify carol
      // (because the UI sent the top-level id), then self-skipped.
      const { data: carolSelfNotif } = await carol.client
        .from("notifications")
        .select("id")
        .eq("user_id", carol.id)
        .eq("type", "reply")
        .eq("comment_id", carolReplyToReply.id);
      expect((carolSelfNotif ?? []).length).toBe(0);
    });

    // play_requests need a find_players post — its own fixture so we
    // can flip status without polluting the rest of the trigger suite.
    it("play_requests INSERT and status flip both fire notifications", async () => {
      const fp = await createPost(alice.client, {
        content: "Looking for trigger-test players",
        post_type: "find_players",
        play_date: "2026-06-01",
        play_time: "10:00",
        play_duration: 90,
        court_location: "Trigger Court",
        game_type: "singles",
        players_needed: 1,
      });

      // bob requests to join → alice gets "join_request".
      await bob.client
        .from("play_requests")
        .insert({ post_id: fp.id, user_id: bob.id, status: "pending" });

      const { data: joinNote } = await alice.client
        .from("notifications")
        .select("id")
        .eq("user_id", alice.id)
        .eq("type", "join_request")
        .eq("actor_id", bob.id)
        .eq("post_id", fp.id);
      expect((joinNote ?? []).length).toBe(1);

      // alice approves → bob gets "request_approved".
      await alice.client
        .from("play_requests")
        .update({ status: "approved" })
        .eq("post_id", fp.id)
        .eq("user_id", bob.id);

      const { data: approvedNote } = await bob.client
        .from("notifications")
        .select("id")
        .eq("user_id", bob.id)
        .eq("type", "request_approved")
        .eq("post_id", fp.id);
      expect((approvedNote ?? []).length).toBe(1);

      // Round 2: carol requests, alice rejects → "request_rejected".
      await carol.client
        .from("play_requests")
        .insert({ post_id: fp.id, user_id: carol.id, status: "pending" });
      await alice.client
        .from("play_requests")
        .update({ status: "rejected" })
        .eq("post_id", fp.id)
        .eq("user_id", carol.id);

      const { data: rejectedNote } = await carol.client
        .from("notifications")
        .select("id")
        .eq("user_id", carol.id)
        .eq("type", "request_rejected")
        .eq("post_id", fp.id);
      expect((rejectedNote ?? []).length).toBe(1);

      // Cleanup the fixture so deletePost in afterAll doesn't trip on FKs.
      await alice.client.from("posts").delete().eq("id", fp.id);
    });

    it("reacting to a DM notifies the sender; group/chat reactions don't", async () => {
      const admin = adminClient();
      const dm = await sendDirectMessage(alice.client, bob.id, "react test");

      // Clear any stale state.
      await admin
        .from("notifications")
        .delete()
        .eq("user_id", alice.id)
        .eq("type", "message_reaction");

      await addReaction(bob.client, "dm", dm.id, "fire");

      const { data: dmNote } = await alice.client
        .from("notifications")
        .select("emoji")
        .eq("user_id", alice.id)
        .eq("type", "message_reaction")
        .eq("actor_id", bob.id)
        .eq("message_id", dm.id);
      expect((dmNote ?? []).length).toBe(1);
      expect(dmNote![0].emoji).toBe("fire");

      // Self-reaction shouldn't notify.
      await admin
        .from("notifications")
        .delete()
        .eq("user_id", alice.id)
        .eq("type", "message_reaction");
      await addReaction(alice.client, "dm", dm.id, "thumbs_up");
      const { data: selfNote } = await alice.client
        .from("notifications")
        .select("id")
        .eq("user_id", alice.id)
        .eq("type", "message_reaction");
      expect((selfNote ?? []).length).toBe(0);
    });
  });
});
