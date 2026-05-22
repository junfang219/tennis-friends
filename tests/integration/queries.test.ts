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
  // Messages
  listDirectMessages,
  sendDirectMessage,
  markDmRead,
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
});
