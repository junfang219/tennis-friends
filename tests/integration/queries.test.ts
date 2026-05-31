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
  updateComment,
  deleteComment,
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
  listGroupFeed,
  listGroupMessages,
  sendGroupMessage,
  // Events
  listEvents,
  listMyEvents,
  countRegisteredByEvent,
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
  // Upcoming games (arrival hook)
  listUpcomingFindPlayersGames,
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

    it("createPost round-trips court_facility_id and returns it on the post", async () => {
      // Explicit picks from the composer typeahead must persist through
      // createPost → POST_COLUMNS → getPost without being dropped. The
      // post card renders /courts?selected=tf-N off this column.
      const p = await createPost(alice.client, {
        content: "court facility id round trip",
        post_type: "find_players",
        play_date: "2026-05-30",
        play_time: "10:00",
        play_duration: 90,
        court_location: "Lower Woodland Playfield Tennis Courts",
        court_facility_id: "tf-20",
        game_type: "singles",
        players_needed: 1,
      });
      expect(p.court_facility_id).toBe("tf-20");

      // Re-fetch to confirm POST_COLUMNS includes the column (not just
      // the insert RETURNING; PostCard reads via getPost / listFeed).
      const fetched = await getPost(alice.client, p.id);
      expect(fetched?.court_facility_id).toBe("tf-20");

      await deletePost(alice.client, p.id);
    });

    it("createPost leaves court_facility_id null when the caller omits it", async () => {
      // Free-text entries that don't get a resolver match in the composer
      // arrive at createPost with court_facility_id unset. The DB column
      // is nullable; the row must come back with null, not "".
      const p = await createPost(alice.client, {
        content: "free text court location",
        post_type: "find_players",
        play_date: "2026-05-30",
        play_time: "10:00",
        play_duration: 90,
        court_location: "My friend's secret backyard court",
        game_type: "singles",
        players_needed: 1,
      });
      expect(p.court_facility_id).toBeNull();
      await deletePost(alice.client, p.id);
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

    // Regression: propose_team posts used to auto-create a Group when
    // they filled (via the deleted src/lib/teamGroup.ts), which made the
    // "Team formed → Open team" CTA work and surfaced the new team on
    // /groups ("Your Teams"). The Prisma → Supabase burn-down dropped
    // that logic; this commit restores it as the
    // create_team_group_on_complete trigger.
    it("flipping a propose_team post to is_complete auto-creates a Group", async () => {
      const post = await createPost(alice.client, {
        content: "Recruiting for a Wednesday-night doubles team",
        post_type: "propose_team",
        // court_location doubles as the team name on propose_team posts.
        court_location: "Wednesday Wolves",
        players_needed: 1,
      });

      // No team yet — posts.team_group_id starts at the '' default.
      const before = await alice.client
        .from("posts")
        .select("team_group_id")
        .eq("id", post.id)
        .single();
      expect(before.data?.team_group_id).toBe("");

      // Flip to complete. The AFTER UPDATE OF is_complete trigger should
      // create the group, add the author as owner, post a welcome
      // group_message, and set posts.team_group_id.
      const upd = await alice.client
        .from("posts")
        .update({ players_confirmed: 1, is_complete: true })
        .eq("id", post.id);
      expect(upd.error).toBeNull();

      const after = await alice.client
        .from("posts")
        .select("team_group_id")
        .eq("id", post.id)
        .single();
      const teamGroupId = after.data?.team_group_id;
      expect(teamGroupId).toBeTruthy();
      expect(teamGroupId).not.toBe("");

      const group = await alice.client
        .from("groups")
        .select("id, name, owner_id")
        .eq("id", teamGroupId!)
        .single();
      expect(group.data?.name).toBe("Wednesday Wolves");
      expect(group.data?.owner_id).toBe(alice.id);

      const members = await alice.client
        .from("group_members")
        .select("user_id, roles")
        .eq("group_id", teamGroupId!);
      expect(members.data?.map((m) => m.user_id)).toEqual([alice.id]);
      // Ownership lives on groups.owner_id (asserted above); the owner's
      // role set is empty — they get both capabilities implicitly.
      expect(members.data?.[0].roles).toEqual([]);

      const messages = await alice.client
        .from("group_messages")
        .select("content, sender_id")
        .eq("group_id", teamGroupId!);
      expect(messages.data ?? []).toHaveLength(1);
      expect(messages.data![0].sender_id).toBe(alice.id);
      expect(messages.data![0].content).toContain("Team formed");

      // Idempotent: a second is_complete=true UPDATE must not create a
      // second group — the trigger's team_group_id guard short-circuits.
      await alice.client
        .from("posts")
        .update({ is_complete: true })
        .eq("id", post.id);
      const stillOne = await alice.client
        .from("groups")
        .select("id")
        .eq("owner_id", alice.id)
        .eq("id", teamGroupId!);
      expect(stillOne.data ?? []).toHaveLength(1);

      // Cleanup. group_members + group_messages cascade from groups.
      await alice.client.from("groups").delete().eq("id", teamGroupId!);
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
      // The groups_auto_add_owner trigger writes alice's owner row;
      // only add the extra member here.
      const admin = adminClient();
      await admin.from("group_members").insert([
        { group_id: groupId, user_id: bob.id, roles: [] },
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

    // A post created on the team page gets a post_targets group row, which
    // both scopes its visibility (can_see_post) and feeds the team page via
    // listGroupFeed. The home feed still surfaces it for fellow members
    // (RLS), but a non-member sees it nowhere.
    it("listGroupFeed returns the group's targeted posts to members, hides them from non-members", async () => {
      const post = await createPost(alice.client, {
        content: "Practice this Saturday 9am",
        post_type: "regular",
      });
      const { error: targetErr } = await alice.client
        .from("post_targets")
        .insert({ post_id: post.id, target_kind: "group", group_id: groupId });
      expect(targetErr).toBeNull();

      // Owner and member see it on the team page.
      const aliceGroupFeed = await listGroupFeed(alice.client, groupId);
      expect(aliceGroupFeed.some((p) => p.id === post.id)).toBe(true);
      const bobGroupFeed = await listGroupFeed(bob.client, groupId);
      expect(bobGroupFeed.some((p) => p.id === post.id)).toBe(true);

      // Member also sees it in the home feed; non-member sees it in neither.
      const bobHomeFeed = await listFeed(bob.client, { limit: 50 });
      expect(bobHomeFeed.some((p) => p.id === post.id)).toBe(true);
      const carolGroupFeed = await listGroupFeed(carol.client, groupId);
      expect(carolGroupFeed.some((p) => p.id === post.id)).toBe(false);
      const carolHomeFeed = await listFeed(carol.client, { limit: 50 });
      expect(carolHomeFeed.some((p) => p.id === post.id)).toBe(false);

      await alice.client.from("posts").delete().eq("id", post.id);
    });

    // enrichPosts must resolve post_targets into post.groups so PostCard shows
    // the right audience badge AND the edit modal pre-selects the actual
    // groups. An empty post.groups here is the bug that made every edit wipe
    // the target and re-broadcast the post to all friends.
    it("listFeed/getPost populate post.groups from post_targets", async () => {
      const post = await createPost(alice.client, {
        content: "Targeted at the squad",
        post_type: "regular",
      });
      await alice.client
        .from("post_targets")
        .insert({ post_id: post.id, target_kind: "group", group_id: groupId });

      const fetched = await getPost(alice.client, post.id);
      expect(fetched?.groups).toEqual([{ id: groupId, name: "Test Squad" }]);
      expect(fetched?.friend_groups).toEqual([]);

      const feed = await listFeed(alice.client, { limit: 50 });
      const inFeed = feed.find((p) => p.id === post.id);
      expect(inFeed?.groups.some((g) => g.id === groupId)).toBe(true);

      await alice.client.from("posts").delete().eq("id", post.id);
    });

    it("post.groups is empty for an untargeted post", async () => {
      const post = await createPost(alice.client, {
        content: "No audience target",
        post_type: "regular",
      });
      const fetched = await getPost(alice.client, post.id);
      expect(fetched?.groups).toEqual([]);
      expect(fetched?.friend_groups).toEqual([]);
      await alice.client.from("posts").delete().eq("id", post.id);
    });

    // A plain friend-visibility post (no group target) must NOT leak into the
    // team page feed — listGroupFeed is restricted to group-targeted posts.
    it("listGroupFeed excludes untargeted posts", async () => {
      const post = await createPost(alice.client, {
        content: "Just a normal post",
        post_type: "regular",
      });
      const groupFeed = await listGroupFeed(alice.client, groupId);
      expect(groupFeed.some((p) => p.id === post.id)).toBe(false);
      await alice.client.from("posts").delete().eq("id", post.id);
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
      const upcoming = await listEvents(alice.client, { mode: "upcoming" });
      expect(upcoming.some((x) => x.id === eventId)).toBe(true);
    });

    // Regression: listEvents({ mode: 'past' }) used to return everything
    // when upcoming was false (the page just rendered the unfiltered
    // list), so the Past tab showed upcoming events too.
    it("listEvents splits upcoming vs. past by end_date", async () => {
      const admin = adminClient();
      const { data: pastRow } = await admin
        .from("events")
        .insert({
          owner_id: alice.id,
          title: "Last Week's Mixer",
          event_type: "mixer",
          start_date: new Date(Date.now() - 86_400_000 * 8).toISOString(),
          end_date: new Date(Date.now() - 86_400_000 * 7).toISOString(),
          is_public_signup: true,
          visibility: "public",
          event_lat: 47.6062,
          event_lng: -122.3321,
          radius_mi: 25,
        })
        .select("id")
        .single();
      const pastId = pastRow!.id;

      const upcoming = await listEvents(alice.client, { mode: "upcoming" });
      const past = await listEvents(alice.client, { mode: "past" });

      expect(upcoming.some((x) => x.id === eventId)).toBe(true);
      expect(upcoming.some((x) => x.id === pastId)).toBe(false);
      expect(past.some((x) => x.id === pastId)).toBe(true);
      expect(past.some((x) => x.id === eventId)).toBe(false);

      // Cancelled events belong in Past regardless of their dates so
      // they don't dangle in Upcoming.
      await admin
        .from("events")
        .update({ status: "cancelled" })
        .eq("id", pastId);
      const futureCancelledInsert = await admin
        .from("events")
        .insert({
          owner_id: alice.id,
          title: "Cancelled Future",
          event_type: "mixer",
          start_date: new Date(Date.now() + 86_400_000 * 14).toISOString(),
          end_date: new Date(Date.now() + 86_400_000 * 15).toISOString(),
          status: "cancelled",
          is_public_signup: true,
          visibility: "public",
          event_lat: 47.6062,
          event_lng: -122.3321,
          radius_mi: 25,
        })
        .select("id")
        .single();
      const cancelledId = futureCancelledInsert.data!.id;

      const upcomingAfter = await listEvents(alice.client, { mode: "upcoming" });
      const pastAfter = await listEvents(alice.client, { mode: "past" });
      expect(upcomingAfter.some((x) => x.id === cancelledId)).toBe(false);
      expect(pastAfter.some((x) => x.id === cancelledId)).toBe(true);

      await admin.from("events").delete().in("id", [pastId, cancelledId]);
    });

    // Regression: listMyEvents used to UNION owner_id = me, so an
    // organizer who created an event without RSVPing saw it in their
    // "My Events" tab. Mimi hit this on prod with Fun + Ttyy. The tab
    // should only show events the user is actually playing in.
    it("listMyEvents returns RSVP'd events only — not owned-but-not-RSVPed", async () => {
      const admin = adminClient();
      // Alice owns the test event but never inserted a participant row
      // for herself, so it should NOT be in her My Events.
      const aliceList = await listMyEvents(alice.client);
      expect(aliceList.some((x) => x.id === eventId)).toBe(false);

      // Bob has nothing of his own and isn't signed up yet.
      const before = await listMyEvents(bob.client);
      expect(before.some((x) => x.id === eventId)).toBe(false);

      await admin
        .from("event_participants")
        .insert({ event_id: eventId, user_id: bob.id, status: "registered" });
      const after = await listMyEvents(bob.client);
      expect(after.some((x) => x.id === eventId)).toBe(true);

      // Withdrawn participants drop out of the list.
      await admin
        .from("event_participants")
        .update({ status: "withdrawn" })
        .eq("event_id", eventId)
        .eq("user_id", bob.id);
      const afterWithdraw = await listMyEvents(bob.client);
      expect(afterWithdraw.some((x) => x.id === eventId)).toBe(false);

      // Waitlist counts as "playing in" — it's a real RSVP.
      await admin
        .from("event_participants")
        .update({ status: "waitlist" })
        .eq("event_id", eventId)
        .eq("user_id", bob.id);
      const afterWaitlist = await listMyEvents(bob.client);
      expect(afterWaitlist.some((x) => x.id === eventId)).toBe(true);

      // Reset so the subsequent signup test starts from a clean slate.
      await admin
        .from("event_participants")
        .delete()
        .eq("event_id", eventId)
        .eq("user_id", bob.id);
    });

    // Regression: event cards showed "0 signed up" because the page
    // hardcoded registeredCount: 0. countRegisteredByEvent batches the
    // count and ignores waitlist/withdrawn rows.
    it("countRegisteredByEvent counts only registered rows", async () => {
      const admin = adminClient();
      // Two extra events so the count map has multiple entries.
      const futureA = await admin
        .from("events")
        .insert({
          owner_id: alice.id,
          title: "Count A",
          event_type: "mixer",
          start_date: new Date(Date.now() + 86_400_000).toISOString(),
          end_date: new Date(Date.now() + 86_400_000 * 2).toISOString(),
          is_public_signup: true,
          visibility: "public",
          event_lat: 47.6062,
          event_lng: -122.3321,
          radius_mi: 25,
        })
        .select("id")
        .single();
      const futureB = await admin
        .from("events")
        .insert({
          owner_id: alice.id,
          title: "Count B",
          event_type: "mixer",
          start_date: new Date(Date.now() + 86_400_000).toISOString(),
          end_date: new Date(Date.now() + 86_400_000 * 2).toISOString(),
          is_public_signup: true,
          visibility: "public",
          event_lat: 47.6062,
          event_lng: -122.3321,
          radius_mi: 25,
        })
        .select("id")
        .single();
      const aId = futureA.data!.id;
      const bId = futureB.data!.id;

      // A: alice + bob registered, carol waitlisted -> count = 2
      //    (the waitlist row must not contribute).
      // B: alice registered, bob withdrawn -> count = 1
      //    (the withdrawn row must not contribute).
      await admin.from("event_participants").insert([
        { event_id: aId, user_id: alice.id, status: "registered" },
        { event_id: aId, user_id: bob.id, status: "registered" },
        { event_id: aId, user_id: carol.id, status: "waitlist" },
        { event_id: bId, user_id: alice.id, status: "registered" },
        { event_id: bId, user_id: bob.id, status: "withdrawn" },
      ]);

      const counts = await countRegisteredByEvent(alice.client, [aId, bId]);
      expect(counts.get(aId)).toBe(2);
      expect(counts.get(bId)).toBe(1);

      // Empty-input fast path returns an empty map without hitting the DB.
      const empty = await countRegisteredByEvent(alice.client, []);
      expect(empty.size).toBe(0);

      // Unknown event IDs: not present in the map (caller treats as 0).
      const unknown = await countRegisteredByEvent(alice.client, [
        "00000000-0000-0000-0000-000000000000",
      ]);
      expect(unknown.size).toBe(0);

      await admin.from("events").delete().in("id", [aId, bId]);
    });

    // Event creation cross-posts a recruitment card to the feed. The
    // post carries the event_id and post_type='event'; enrichPosts
    // resolves it into post.event so PostCard's EventChip renders
    // date / venue / type without a follow-up fetch.
    it("posts cross-posted from an event surface post.event in the feed", async () => {
      const admin = adminClient();
      // Make sure alice is within broadcast radius (she defaults to
      // Seattle anyway, but be explicit so the test isn't dependent on
      // earlier test ordering).
      await admin
        .from("profiles")
        .update({ latitude: 47.6062, longitude: -122.3321 })
        .eq("id", alice.id);

      const evIns = await admin
        .from("events")
        .insert({
          owner_id: alice.id,
          title: "Sunday Round Robin",
          description: "Looking for 8 players, 3.5 level.",
          event_type: "round_robin",
          start_date: new Date(Date.now() + 86_400_000).toISOString(),
          end_date: new Date(Date.now() + 86_400_000 * 2).toISOString(),
          venue_name: "Lower Woodland",
          is_public_signup: true,
          visibility: "public",
          event_lat: 47.6062,
          event_lng: -122.3321,
          radius_mi: 25,
        })
        .select("id")
        .single();
      const eventCrossId = evIns.data!.id;

      const recruitPost = await createPost(alice.client, {
        content: "Looking for 8 players, 3.5 level.",
        post_type: "event",
        event_id: eventCrossId,
        is_broadcast: true,
        broadcast_radius_mi: 25,
        broadcast_lat: 47.6062,
        broadcast_lng: -122.3321,
      });

      const fetched = await getPost(alice.client, recruitPost.id);
      expect(fetched?.event?.id).toBe(eventCrossId);
      expect(fetched?.event?.title).toBe("Sunday Round Robin");
      expect(fetched?.event?.event_type).toBe("round_robin");
      expect(fetched?.event?.venue_name).toBe("Lower Woodland");

      const feed = await listFeed(alice.client, { limit: 50 });
      const inFeed = feed.find((p) => p.id === recruitPost.id);
      expect(inFeed?.event?.id).toBe(eventCrossId);

      await alice.client.from("posts").delete().eq("id", recruitPost.id);
      await admin.from("events").delete().eq("id", eventCrossId);
    });

    // A group-visibility event cross-posts with a post_targets row
    // pointing at the host group. The card appears on the group's posts
    // wall AND in members' main feeds; non-members see it in neither.
    it("group-visibility events cross-post to the host group only", async () => {
      const admin = adminClient();
      const { data: grp } = await admin
        .from("groups")
        .insert({ name: "Event Cross-Post Test", owner_id: alice.id })
        .select("id")
        .single();
      const grpId = grp!.id;
      // Add bob as a member; carol stays outside.
      await admin
        .from("group_members")
        .insert({ group_id: grpId, user_id: bob.id, roles: [] });

      const evIns = await admin
        .from("events")
        .insert({
          owner_id: alice.id,
          title: "Squad Practice",
          description: "Members only — let's drill.",
          event_type: "clinic",
          start_date: new Date(Date.now() + 86_400_000).toISOString(),
          end_date: new Date(Date.now() + 86_400_000 * 2).toISOString(),
          is_public_signup: false,
          visibility: "group",
          host_group_id: grpId,
        })
        .select("id")
        .single();
      const eventCrossId = evIns.data!.id;

      const recruitPost = await createPost(alice.client, {
        content: "Members only — let's drill.",
        post_type: "event",
        event_id: eventCrossId,
      });
      await alice.client
        .from("post_targets")
        .insert({ post_id: recruitPost.id, target_kind: "group", group_id: grpId });

      // Author + member see it on the group wall and main feed.
      const aliceGroupFeed = await listGroupFeed(alice.client, grpId);
      expect(aliceGroupFeed.some((p) => p.id === recruitPost.id)).toBe(true);
      const bobGroupFeed = await listGroupFeed(bob.client, grpId);
      expect(bobGroupFeed.some((p) => p.id === recruitPost.id)).toBe(true);
      const bobHomeFeed = await listFeed(bob.client, { limit: 50 });
      expect(bobHomeFeed.some((p) => p.id === recruitPost.id)).toBe(true);

      // Non-member sees it in neither feed.
      const carolGroupFeed = await listGroupFeed(carol.client, grpId);
      expect(carolGroupFeed.some((p) => p.id === recruitPost.id)).toBe(false);
      const carolHomeFeed = await listFeed(carol.client, { limit: 50 });
      expect(carolHomeFeed.some((p) => p.id === recruitPost.id)).toBe(false);

      // Either feed surfaces the enriched event for members.
      const enriched = bobGroupFeed.find((p) => p.id === recruitPost.id);
      expect(enriched?.event?.id).toBe(eventCrossId);
      expect(enriched?.event?.title).toBe("Squad Practice");

      await alice.client.from("posts").delete().eq("id", recruitPost.id);
      await admin.from("events").delete().eq("id", eventCrossId);
      await admin.from("groups").delete().eq("id", grpId);
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

    // Comment edit / delete coverage. RLS gates edit/delete to the
    // author; bump_comment_updated_at sets updated_at only on real
    // content changes; ON DELETE CASCADE removes children + the
    // notifications that point at the deleted comment.
    it("updateComment round-trip: author edits, updated_at bumps, peers read new content", async () => {
      const c = await addComment(bob.client, postId, "original text");
      expect(c.updated_at).toBeNull();

      const edited = await updateComment(bob.client, c.id, "edited text");
      expect(edited.content).toBe("edited text");
      expect(edited.updated_at).not.toBeNull();

      // Peer (post author) sees the new content + updated_at via listComments.
      const all = await listComments(alice.client, postId);
      const target = all.find((row) => row.id === c.id);
      expect(target?.content).toBe("edited text");
      expect(target?.updated_at).not.toBeNull();

      // Cleanup so later trigger tests start from a clean comment slate.
      await deleteComment(bob.client, c.id);
    });

    it("RLS blocks updating someone else's comment", async () => {
      const c = await addComment(bob.client, postId, "bob's words");

      // carol tries to rewrite bob's comment. RLS USING clause yields
      // zero matching rows, so .single() must error and the row stays
      // intact.
      const attempt = await carol.client
        .from("comments")
        .update({ content: "hijacked" })
        .eq("id", c.id)
        .select("id, content");
      // Either an explicit RLS error OR a silent zero-row update —
      // both are acceptable; what matters is the row didn't change.
      const stillBobs = await listComments(alice.client, postId);
      const target = stillBobs.find((row) => row.id === c.id);
      expect(target?.content).toBe("bob's words");
      expect(attempt.data ?? []).toHaveLength(0);

      await deleteComment(bob.client, c.id);
    });

    it("editing a comment does NOT create a new notification", async () => {
      const admin = adminClient();
      // Start clean so we can count the comment-trigger's INSERT.
      await admin
        .from("notifications")
        .delete()
        .in("type", ["comment", "reply"])
        .eq("post_id", postId);

      const c = await addComment(bob.client, postId, "first draft");
      const { data: afterInsert } = await alice.client
        .from("notifications")
        .select("id")
        .eq("user_id", alice.id)
        .eq("type", "comment")
        .eq("post_id", postId)
        .eq("actor_id", bob.id);
      expect((afterInsert ?? []).length).toBe(1);

      // Editing must not fire notify_on_comment again (the trigger
      // is INSERT-only, by design — peers got pinged once; rewording
      // shouldn't re-ping).
      await updateComment(bob.client, c.id, "polished draft");
      const { data: afterEdit } = await alice.client
        .from("notifications")
        .select("id")
        .eq("user_id", alice.id)
        .eq("type", "comment")
        .eq("post_id", postId)
        .eq("actor_id", bob.id);
      expect((afterEdit ?? []).length).toBe(1);

      await deleteComment(bob.client, c.id);
    });

    it("deleting a parent comment cascades to replies and to its notifications", async () => {
      const admin = adminClient();
      await admin
        .from("notifications")
        .delete()
        .in("type", ["comment", "reply"])
        .eq("post_id", postId);

      const parent = await addComment(bob.client, postId, "parent thread");
      const child = await addComment(carol.client, postId, "child reply", parent.id);
      const grandchild = await addComment(
        bob.client,
        postId,
        "grandchild reply",
        child.id
      );

      // Pre-check: the reply trigger created a "reply" notification
      // pointing at the child comment (for bob, the parent's author).
      const { data: replyNotifBefore } = await admin
        .from("notifications")
        .select("id")
        .eq("comment_id", child.id);
      expect((replyNotifBefore ?? []).length).toBeGreaterThan(0);

      // Author of the parent deletes it. CASCADE on parent_comment_id
      // should remove both child + grandchild; CASCADE on
      // notifications.comment_id should remove the reply notif.
      await deleteComment(bob.client, parent.id);

      const remaining = await listComments(alice.client, postId);
      const survivingIds = new Set(remaining.map((r) => r.id));
      expect(survivingIds.has(parent.id)).toBe(false);
      expect(survivingIds.has(child.id)).toBe(false);
      expect(survivingIds.has(grandchild.id)).toBe(false);

      const { data: replyNotifAfter } = await admin
        .from("notifications")
        .select("id")
        .in("comment_id", [parent.id, child.id, grandchild.id]);
      expect((replyNotifAfter ?? []).length).toBe(0);
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

  // -------------------------------------------------------------------
  // Migration regression coverage: triggers + RPCs restored after the
  // Prisma → Supabase burn-down (86f26a5) dropped server-side
  // orchestration. Each test mirrors a deleted route handler so a
  // future migration can't silently regress the same behavior again.
  // -------------------------------------------------------------------
  describe("restored side-effects (burn-down regression coverage)", () => {
    beforeAll(async () => {
      try { await befriend(alice, bob); } catch { /* already friends */ }
      try { await befriend(alice, carol); } catch { /* already friends */ }
    });

    // G1 — approved play_request -> 'withdrawn' frees the slot AND DMs
    // the post author with the withdraw note, linked via shared_post_id.
    it("withdrawing an approved play_request DMs the author and frees the slot", async () => {
      const post = await createPost(alice.client, {
        content: "Looking for 1 player",
        post_type: "find_players",
        play_date: "2026-05-26",
        play_time: "14:00",
        play_duration: 90,
        court_location: "Test Court",
        game_type: "singles",
        players_needed: 1,
      });

      const { data: req } = await bob.client
        .from("play_requests")
        .insert({ post_id: post.id, user_id: bob.id, status: "approved" })
        .select("id")
        .single();
      await alice.client
        .from("posts")
        .update({ players_confirmed: 1 })
        .eq("id", post.id);

      const { error: wErr } = await bob.client
        .from("play_requests")
        .update({ status: "withdrawn", note: "schedule clash" })
        .eq("id", req!.id);
      expect(wErr).toBeNull();

      const after = await alice.client
        .from("posts")
        .select("players_confirmed, is_complete")
        .eq("id", post.id)
        .single();
      expect(after.data?.players_confirmed).toBe(0);
      expect(after.data?.is_complete).toBe(false);

      const { data: dm } = await alice.client
        .from("messages")
        .select("sender_id, content, shared_post_id")
        .eq("receiver_id", alice.id)
        .eq("sender_id", bob.id)
        .eq("shared_post_id", post.id);
      expect((dm ?? []).length).toBe(1);
      expect(dm![0].content).toContain("withdrew");
      expect(dm![0].content).toContain("schedule clash");

      await alice.client.from("messages").delete().eq("shared_post_id", post.id);
      await deletePost(alice.client, post.id);
    });

    // G2 — author removing an approved player DMs the kicked player and
    // frees the slot. play_request status persists as 'removed'.
    it("removing an approved player DMs them and frees the slot", async () => {
      const post = await createPost(alice.client, {
        content: "Looking for 1 player",
        post_type: "find_players",
        play_date: "2026-05-26",
        play_time: "14:00",
        play_duration: 90,
        court_location: "Test Court",
        game_type: "singles",
        players_needed: 1,
      });
      const { data: req } = await bob.client
        .from("play_requests")
        .insert({ post_id: post.id, user_id: bob.id, status: "approved" })
        .select("id")
        .single();
      await alice.client
        .from("posts")
        .update({ players_confirmed: 1 })
        .eq("id", post.id);

      const { error: rmErr } = await alice.client
        .from("play_requests")
        .update({ status: "removed", note: "ratings mismatch" })
        .eq("id", req!.id);
      expect(rmErr).toBeNull();

      const after = await alice.client
        .from("posts")
        .select("players_confirmed, is_complete")
        .eq("id", post.id)
        .single();
      expect(after.data?.players_confirmed).toBe(0);
      expect(after.data?.is_complete).toBe(false);

      const { data: dm } = await bob.client
        .from("messages")
        .select("sender_id, content, shared_post_id")
        .eq("receiver_id", bob.id)
        .eq("sender_id", alice.id)
        .eq("shared_post_id", post.id);
      expect((dm ?? []).length).toBe(1);
      expect(dm![0].content).toContain("removed you");
      expect(dm![0].content).toContain("ratings mismatch");

      await alice.client.from("messages").delete().eq("shared_post_id", post.id);
      await deletePost(alice.client, post.id);
    });

    // G4 — tournament with at least one event_matches row rejects new
    // event_participants inserts with the "Bracket is live" message.
    it("tournament signup is locked once the bracket is seeded", async () => {
      const { data: ev } = await alice.client
        .from("events")
        .insert({
          owner_id: alice.id,
          title: "Bracket Lock Test",
          event_type: "tournament",
          start_date: new Date(Date.now() + 86_400_000).toISOString(),
          end_date: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          visibility: "public",
          is_public_signup: true,
        })
        .select("id")
        .single();
      const eventId = ev!.id;

      // Seed a single match row to simulate a live bracket. RLS lets the
      // organizer insert event_matches (insert policy is owner-only).
      const { error: matchErr } = await alice.client
        .from("event_matches")
        .insert({
          event_id: eventId,
          player1_id: alice.id,
          player2_id: bob.id,
          status: "scheduled",
          bracket_slot: "R1-1",
          round: 1,
        });
      expect(matchErr).toBeNull();

      const { error: signupErr } = await carol.client
        .from("event_participants")
        .insert({ event_id: eventId, user_id: carol.id, status: "registered" });
      expect(signupErr?.message).toContain("Bracket is live");

      await alice.client.from("events").delete().eq("id", eventId);
    });

    // G5 — event with an NTRP band rejects signups outside the band.
    it("event NTRP gate rejects out-of-band signups", async () => {
      await carol.client.from("profiles").update({ ntrp_rating: 3.0 }).eq("id", carol.id);

      const { data: ev } = await alice.client
        .from("events")
        .insert({
          owner_id: alice.id,
          title: "NTRP Gate Test",
          event_type: "mixer",
          start_date: new Date(Date.now() + 86_400_000).toISOString(),
          end_date: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          visibility: "public",
          is_public_signup: true,
          ntrp_min: 4.0,
        })
        .select("id")
        .single();
      const eventId = ev!.id;
      // Public events without lat/lng/radius aren't visible via the
      // distance branch of can_see_event — grant carol visibility via
      // the invite path so RLS lets her INSERT.
      const admin = adminClient();
      await admin.from("notifications").insert({
        user_id: carol.id,
        actor_id: alice.id,
        type: "event_invite",
        event_id: eventId,
      });

      const { error: lowErr } = await carol.client
        .from("event_participants")
        .insert({ event_id: eventId, user_id: carol.id, status: "registered" });
      expect(lowErr?.message).toContain("NTRP");

      await carol.client.from("profiles").update({ ntrp_rating: 4.5 }).eq("id", carol.id);
      const { error: okErr } = await carol.client
        .from("event_participants")
        .insert({ event_id: eventId, user_id: carol.id, status: "registered" });
      expect(okErr).toBeNull();

      await alice.client.from("events").delete().eq("id", eventId);
    });

    // G6/G7/G8 — match status fan-out. Events no longer have a backing
    // group chat, so this is notification-only. Both alice and bob are
    // registered participants so they pass can_see_event for the match
    // row — RLS on event_matches inherits SELECT visibility from
    // can_see_event, so players must also be registered to UPDATE their
    // own match (this mirrors real usage).
    it("event match report/confirm/dispute fans out notifications", async () => {
      const { data: ev } = await alice.client
        .from("events")
        .insert({
          owner_id: alice.id,
          title: "Match FanOut",
          event_type: "round_robin",
          start_date: new Date(Date.now() + 86_400_000).toISOString(),
          end_date: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          visibility: "public",
          is_public_signup: true,
        })
        .select("id")
        .single();
      const eventId = ev!.id;
      // Both players need to be registered so can_see_event returns true
      // and SELECT RLS lets them see the match row.
      const adminPre = adminClient();
      await adminPre.from("event_participants").insert([
        { event_id: eventId, user_id: alice.id, status: "registered" },
        { event_id: eventId, user_id: bob.id, status: "registered" },
      ]);
      const { data: m } = await alice.client
        .from("event_matches")
        .insert({
          event_id: eventId,
          player1_id: alice.id,
          player2_id: bob.id,
          status: "scheduled",
        })
        .select("id")
        .single();
      const matchId = m!.id;

      // alice reports -> bob notified
      await alice.client
        .from("event_matches")
        .update({ score: "6-4,6-3", winner_side: 1, reported_by: alice.id, status: "in_progress" })
        .eq("id", matchId);
      const { data: reportNote } = await bob.client
        .from("notifications")
        .select("type, actor_id, match_id")
        .eq("user_id", bob.id)
        .eq("type", "event_match_report")
        .eq("match_id", matchId);
      expect((reportNote ?? []).length).toBe(1);
      expect(reportNote![0].actor_id).toBe(alice.id);

      // bob confirms -> alice (reporter) notified
      const bobUpd = await bob.client
        .from("event_matches")
        .update({ confirmed_by: bob.id, status: "completed" })
        .eq("id", matchId);
      expect(bobUpd.error).toBeNull();
      const { data: confirmNote } = await alice.client
        .from("notifications")
        .select("type, actor_id, match_id")
        .eq("user_id", alice.id)
        .eq("type", "event_match_confirmed")
        .eq("match_id", matchId);
      expect((confirmNote ?? []).length).toBe(1);
      expect(confirmNote![0].actor_id).toBe(bob.id);

      // Dispute path: rewind to in_progress with alice as reporter, then
      // bob disputes by writing disputed_at + reverting to scheduled.
      await alice.client
        .from("event_matches")
        .update({ score: "7-5,6-4", winner_side: 1, reported_by: alice.id, status: "in_progress" })
        .eq("id", matchId);
      // Clear the prior dispute notification so we can assert the new one.
      const admin = adminClient();
      await admin.from("notifications").delete().eq("match_id", matchId).eq("type", "event_match_disputed");
      await bob.client
        .from("event_matches")
        .update({
          score: "",
          winner_side: null,
          reported_by: null,
          confirmed_by: null,
          disputed_at: new Date().toISOString(),
          status: "scheduled",
        })
        .eq("id", matchId);
      const { data: disputeNote } = await alice.client
        .from("notifications")
        .select("type, actor_id, match_id")
        .eq("user_id", alice.id)
        .eq("type", "event_match_disputed")
        .eq("match_id", matchId);
      expect((disputeNote ?? []).length).toBe(1);
      expect(disputeNote![0].actor_id).toBe(bob.id);

      await alice.client.from("events").delete().eq("id", eventId);
    });

    // G11 — invite_to_event RPC: organizer-only, friends-only,
    // skip-already-participating, skip-already-invited.
    it("invite_to_event RPC enforces organizer + friends + dedupe", async () => {
      const { data: ev } = await alice.client
        .from("events")
        .insert({
          owner_id: alice.id,
          title: "Invite RPC Test",
          event_type: "mixer",
          start_date: new Date(Date.now() + 86_400_000).toISOString(),
          end_date: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          visibility: "public",
          is_public_signup: true,
        })
        .select("id")
        .single();
      const eventId = ev!.id;

      // Non-organizer can't invite.
      const denied = await bob.client.rpc("invite_to_event", {
        p_event_id: eventId,
        p_user_ids: [carol.id],
      });
      expect(denied.error?.message).toContain("organizer");

      // Organizer invites two friends. carol is a friend; a stranger UUID
      // is filtered out by the friends-only gate.
      const strangerId = "00000000-0000-0000-0000-000000000000";
      const ok = await alice.client.rpc("invite_to_event", {
        p_event_id: eventId,
        p_user_ids: [carol.id, strangerId],
      });
      expect(ok.error).toBeNull();
      expect((ok.data as { invited: number } | null)?.invited).toBe(1);

      // Idempotent: re-inviting carol skips her.
      const second = await alice.client.rpc("invite_to_event", {
        p_event_id: eventId,
        p_user_ids: [carol.id],
      });
      expect((second.data as { invited: number } | null)?.invited).toBe(0);

      // If carol already signed up, she's skipped too.
      await carol.client
        .from("event_participants")
        .insert({ event_id: eventId, user_id: carol.id, status: "registered" });
      await adminClient()
        .from("notifications")
        .delete()
        .eq("event_id", eventId)
        .eq("type", "event_invite");
      const third = await alice.client.rpc("invite_to_event", {
        p_event_id: eventId,
        p_user_ids: [carol.id],
      });
      expect((third.data as { invited: number } | null)?.invited).toBe(0);

      await alice.client.from("events").delete().eq("id", eventId);
    });

    // U5 — events do NOT auto-create a backing group or chat. Creating
    // an event leaves the creator's group list untouched: no new groups
    // row, no group_members row, no welcome message. (We pre-snapshot
    // groups the creator already owns so the assertion isolates the
    // event's effect from any unrelated test fixture state.)
    it("event create does not spin up a backing group or chat", async () => {
      const { data: beforeGroups } = await alice.client
        .from("groups")
        .select("id")
        .eq("owner_id", alice.id);
      const beforeIds = new Set((beforeGroups ?? []).map((g) => g.id));

      const { data: ev } = await alice.client
        .from("events")
        .insert({
          owner_id: alice.id,
          title: "No Backing Group Test",
          event_type: "mixer",
          start_date: new Date(Date.now() + 86_400_000).toISOString(),
          end_date: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          visibility: "public",
          is_public_signup: true,
        })
        .select("id")
        .single();

      const { data: afterGroups } = await alice.client
        .from("groups")
        .select("id")
        .eq("owner_id", alice.id);
      const newGroups = (afterGroups ?? []).filter((g) => !beforeIds.has(g.id));
      expect(newGroups).toEqual([]);

      await alice.client.from("events").delete().eq("id", ev!.id);
    });

    // U1 — only the event organizer can write checked_in_at. Players
    // can still update their own status / registered_at.
    it("checked_in_at is gated to the event organizer", async () => {
      const { data: ev } = await alice.client
        .from("events")
        .insert({
          owner_id: alice.id,
          title: "Checkin Gate Test",
          event_type: "mixer",
          start_date: new Date(Date.now() + 86_400_000).toISOString(),
          end_date: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          visibility: "public",
          is_public_signup: true,
        })
        .select("id")
        .single();
      const eventId = ev!.id;

      const admin = adminClient();
      const { data: bobPart } = await admin
        .from("event_participants")
        .insert({ event_id: eventId, user_id: bob.id, status: "registered" })
        .select("id")
        .single();

      // bob tries to self-check-in -> rejected.
      const selfCheckin = await bob.client
        .from("event_participants")
        .update({ checked_in_at: new Date().toISOString() })
        .eq("id", bobPart!.id);
      expect(selfCheckin.error?.message).toContain("organizer");

      // alice (organizer) checks bob in -> OK.
      const aliceCheckin = await alice.client
        .from("event_participants")
        .update({ checked_in_at: new Date().toISOString() })
        .eq("id", bobPart!.id);
      expect(aliceCheckin.error).toBeNull();

      await alice.client.from("events").delete().eq("id", eventId);
    });

    // G12 — DM, session-chat, team-chat and reaction inserts all
    // dispatch a push-fanout call. The actual APN delivery lives in
    // the edge function (and no-ops without APNS_* secrets); we verify
    // the dispatch path via edge_function_dispatch_log so the test
    // doesn't depend on real device tokens.
    it("DM insert dispatches push-fanout with the right body", async () => {
      const admin = adminClient();
      // Cull stale rows so the assertion below only sees this DM.
      await admin
        .from("edge_function_dispatch_log")
        .delete()
        .eq("fn_name", "push-fanout");

      await sendDirectMessage(alice.client, bob.id, "ping over realtime!");

      const { data: log } = await admin
        .from("edge_function_dispatch_log")
        .select("fn_name, body")
        .eq("fn_name", "push-fanout")
        .order("created_at", { ascending: false })
        .limit(5);
      const match = (log ?? []).find((r) => {
        const body = r.body as { data?: { kind?: string } } | null;
        return body?.data?.kind === "dm";
      });
      expect(match).toBeDefined();
      const body = match!.body as Record<string, unknown>;
      expect(body.user_ids).toEqual([bob.id]);
      expect(body.body).toContain("ping over realtime!");
      expect((body.data as Record<string, string>).sender_id).toBe(alice.id);
      await admin
        .from("edge_function_dispatch_log")
        .delete()
        .eq("fn_name", "push-fanout");
    });

    it("group message insert dispatches push-fanout to every member except sender", async () => {
      const admin = adminClient();
      const { data: grp } = await admin
        .from("groups")
        .insert({ name: "Push Group Test", owner_id: alice.id })
        .select("id")
        .single();
      const groupId = grp!.id;
      // alice (owner) is added by the groups_auto_add_owner trigger.
      await admin.from("group_members").insert([
        { group_id: groupId, user_id: bob.id, roles: [] },
        { group_id: groupId, user_id: carol.id, roles: [] },
      ]);
      await admin
        .from("edge_function_dispatch_log")
        .delete()
        .eq("fn_name", "push-fanout");

      await admin.from("group_messages").insert({
        group_id: groupId,
        sender_id: alice.id,
        content: "team meeting at 6pm",
      });

      const { data: log } = await admin
        .from("edge_function_dispatch_log")
        .select("body")
        .eq("fn_name", "push-fanout")
        .order("created_at", { ascending: false });
      const match = (log ?? []).find((r) => {
        const body = r.body as { data?: { kind?: string; group_id?: string } } | null;
        return body?.data?.kind === "group" && body.data.group_id === groupId;
      });
      expect(match).toBeDefined();
      const recipients = (match!.body as { user_ids: string[] }).user_ids;
      expect(recipients).toEqual(expect.arrayContaining([bob.id, carol.id]));
      expect(recipients).not.toContain(alice.id);

      await admin.from("groups").delete().eq("id", groupId);
      await admin
        .from("edge_function_dispatch_log")
        .delete()
        .eq("fn_name", "push-fanout");
    });

    // G13 — group_invites INSERT calls public.invoke_edge_function,
    // which logs the dispatch in edge_function_dispatch_log. The
    // pg_net side is async/fire-and-forget; we verify the dispatch
    // attempt via the log table so the test doesn't race the worker.
    it("group_invites insert dispatches the group-invite-email function", async () => {
      const admin = adminClient();
      const { data: grp } = await admin
        .from("groups")
        .insert({ name: "Email Trigger Test", owner_id: alice.id })
        .select("id")
        .single();
      const groupId = grp!.id;
      // owner row is auto-inserted by groups_auto_add_owner.

      const token =
        "test-token-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      const { error: inviteErr } = await admin.from("group_invites").insert({
        group_id: groupId,
        email: "invitee@tennisfriend.test",
        invited_by_id: alice.id,
        token,
        expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      });
      expect(inviteErr).toBeNull();

      const { data: log } = await admin
        .from("edge_function_dispatch_log")
        .select("fn_name, body")
        .eq("fn_name", "group-invite-email")
        .order("created_at", { ascending: false })
        .limit(5);
      const match = (log ?? []).find(
        (r) => (r.body as { token?: string } | null)?.token === token
      );
      expect(match).toBeDefined();
      const body = match!.body as Record<string, unknown>;
      expect(body.to).toBe("invitee@tennisfriend.test");
      expect(body.team_name).toBe("Email Trigger Test");
      expect(body.inviter_name).toBeTruthy();

      await admin.from("groups").delete().eq("id", groupId);
      await admin
        .from("edge_function_dispatch_log")
        .delete()
        .eq("fn_name", "group-invite-email")
        .gte("created_at", new Date(Date.now() - 60_000).toISOString());
    });

    // C3 — players_confirmed + is_complete are recomputed server-side
    // from approved play_requests + manual_players. Eliminates the
    // multi-manager race where two concurrent approvals each read the
    // same baseline and wrote N+1.
    it("recount trigger keeps players_confirmed in lock-step with play_requests", async () => {
      const admin = adminClient();
      const post = await createPost(alice.client, {
        content: "Need 2",
        post_type: "find_players",
        play_date: "2026-08-15",
        play_time: "14:00",
        play_duration: 90,
        play_timezone: "America/Los_Angeles",
        court_location: "Lower Woodland",
        game_type: "doubles",
        players_needed: 2,
      });

      // Two concurrent approvals — neither writes posts.players_confirmed.
      await Promise.all([
        admin.from("play_requests").insert({
          post_id: post.id, user_id: bob.id, status: "approved",
        }),
        admin.from("play_requests").insert({
          post_id: post.id, user_id: carol.id, status: "approved",
        }),
      ]);
      const { data: row } = await admin
        .from("posts")
        .select("players_confirmed, is_complete")
        .eq("id", post.id)
        .single();
      expect(row?.players_confirmed).toBe(2);
      expect(row?.is_complete).toBe(true);

      // Withdrawing one approved row drops the count + clears
      // is_complete.
      await admin
        .from("play_requests")
        .update({ status: "withdrawn" })
        .eq("post_id", post.id)
        .eq("user_id", bob.id);
      const { data: after } = await admin
        .from("posts")
        .select("players_confirmed, is_complete")
        .eq("id", post.id)
        .single();
      expect(after?.players_confirmed).toBe(1);
      expect(after?.is_complete).toBe(false);

      // Editing manual_players adds to the count.
      await admin
        .from("posts")
        .update({ manual_players: "Guest A, Guest B" })
        .eq("id", post.id);
      const { data: final } = await admin
        .from("posts")
        .select("players_confirmed, is_complete")
        .eq("id", post.id)
        .single();
      expect(final?.players_confirmed).toBe(3);
      expect(final?.is_complete).toBe(true);

      await admin.from("chats").delete().eq("post_id", post.id);
      await deletePost(alice.client, post.id);
    });

    // C2 — wall-clock play_date/play_time are interpreted in the
    // post's play_timezone, not server UTC. A Pacific user typing
    // "18:00" gets a chat whose session_end_at is anchored to 18:00
    // Pacific, not 18:00 UTC.
    it("create_session_chat_on_complete parses play_time in play_timezone", async () => {
      const admin = adminClient();
      const post = await createPost(alice.client, {
        content: "Need 1",
        post_type: "find_players",
        play_date: "2026-07-15",
        play_time: "18:00",
        play_duration: 90,
        play_timezone: "America/Los_Angeles",
        court_location: "Lower Woodland",
        game_type: "singles",
        players_needed: 1,
      });
      // Flip to complete -> trigger fires.
      await alice.client
        .from("posts")
        .update({ players_confirmed: 1, is_complete: true })
        .eq("id", post.id);
      const { data: chat } = await admin
        .from("chats")
        .select("session_end_at, name")
        .eq("post_id", post.id)
        .single();
      // Pacific 18:00 + 90 min = Pacific 19:30 = 02:30 UTC next day
      // (PDT is UTC-7 in July). Verify the stored UTC matches.
      const stored = new Date(chat!.session_end_at!).toISOString();
      expect(stored.startsWith("2026-07-16T02:30")).toBe(true);
      // Chat name should display the Pacific hour, not the UTC hour.
      expect(chat!.name).toContain("6:00 PM");

      await admin.from("chats").delete().eq("post_id", post.id);
      await deletePost(alice.client, post.id);
    });

    // L1 — re-application of a terminal-state play_request resets to
    // pending; an APPROVED row is never silently flipped (C1 fix).
    it("requestToJoin resets rejected -> pending; never touches approved", async () => {
      const admin = adminClient();
      const post = await createPost(alice.client, {
        content: "Need 1 more",
        post_type: "find_players",
        play_date: "2026-06-30",
        play_time: "14:00",
        play_duration: 90,
        court_location: "Lower Woodland",
        game_type: "singles",
        players_needed: 1,
      });
      const { requestToJoin } = await import("../../src/lib/supabase/queries");

      // rejected -> pending re-apply
      await admin.from("play_requests").insert({
        post_id: post.id,
        user_id: bob.id,
        status: "rejected",
        note: "wrong skill",
      });
      const req = await requestToJoin(bob.client, post.id, "give me another shot");
      expect(req.status).toBe("pending");
      expect(req.note).toBe("give me another shot");

      // approved -> approved (no-op). Carol is already approved; re-call
      // must NOT flip her to pending.
      await admin.from("play_requests").insert({
        post_id: post.id,
        user_id: carol.id,
        status: "approved",
        note: "vetted",
      });
      const carolReq = await requestToJoin(carol.client, post.id, "asking again");
      expect(carolReq.status).toBe("approved");
      // Note text from the re-call must not overwrite the existing row.
      const { data: carolRow } = await admin
        .from("play_requests")
        .select("status, note")
        .eq("post_id", post.id)
        .eq("user_id", carol.id)
        .single();
      expect(carolRow?.status).toBe("approved");
      expect(carolRow?.note).toBe("vetted");

      await deletePost(alice.client, post.id);
    });

    // L4 — chats.session_end_at follows post timing edits. The trigger
    // recomputes the timestamp when play_date / play_time / duration
    // change.
    it("editing a find_players post's timing updates chats.session_end_at", async () => {
      const admin = adminClient();
      const post = await createPost(alice.client, {
        content: "Need 1 more",
        post_type: "find_players",
        play_date: "2026-07-15",
        play_time: "10:00",
        play_duration: 60,
        court_location: "Lower Woodland",
        game_type: "singles",
        players_needed: 1,
      });
      // Flip is_complete to spin up the chat.
      await alice.client
        .from("posts")
        .update({ players_confirmed: 1, is_complete: true })
        .eq("id", post.id);
      const { data: chat } = await admin
        .from("chats")
        .select("id, session_end_at")
        .eq("post_id", post.id)
        .single();
      const originalEnd = new Date(chat!.session_end_at!).getTime();
      expect(Number.isFinite(originalEnd)).toBe(true);

      // Edit timing — shift to next day, longer duration.
      await alice.client
        .from("posts")
        .update({ play_date: "2026-07-16", play_duration: 120 })
        .eq("id", post.id);
      const { data: refreshed } = await admin
        .from("chats")
        .select("session_end_at")
        .eq("id", chat!.id)
        .single();
      const newEnd = new Date(refreshed!.session_end_at!).getTime();
      // Must advance — at least 24h later (different day) + extra duration.
      expect(newEnd - originalEnd).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);

      await admin.from("chats").delete().eq("id", chat!.id);
      await deletePost(alice.client, post.id);
    });

    // C1 — invite redemption RPCs. Validates by token regardless of
    // group_invites RLS, accepts only when the caller's email matches.
    it("accept_group_invite enforces email match + flips status + adds member", async () => {
      const admin = adminClient();
      const { data: grp } = await alice.client
        .from("groups")
        .insert({ name: "Invite Token RPC Test", owner_id: alice.id })
        .select("id")
        .single();
      const groupId = grp!.id;

      // Look up bob's auth email (makeTestUser uses a generated address).
      const { data: bobAuth } = await admin.auth.admin.getUserById(bob.id);
      const bobEmail = bobAuth.user!.email!;

      const token =
        "invite-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      await admin.from("group_invites").insert({
        group_id: groupId,
        email: bobEmail,
        invited_by_id: alice.id,
        token,
        expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      });

      // Token lookup goes through the SECURITY DEFINER RPC, so the
      // invitee (not yet a manager) can read the row.
      const lookup = await bob.client.rpc("get_invite_by_token", {
        p_token: token,
      });
      expect(lookup.error).toBeNull();
      expect((lookup.data as { id?: string } | null)?.id).toBeTruthy();

      // Carol can't accept bob's invite (email mismatch).
      const denied = await carol.client.rpc("accept_group_invite", {
        p_token: token,
      });
      expect(denied.error?.message).toContain("different email");

      // Bob can.
      const ok = await bob.client.rpc("accept_group_invite", {
        p_token: token,
      });
      expect(ok.error).toBeNull();
      expect((ok.data as { ok?: boolean; group_id?: string } | null)?.ok).toBe(true);

      // Membership row landed (with the invite's role set — empty here).
      const { data: member } = await admin
        .from("group_members")
        .select("roles")
        .eq("group_id", groupId)
        .eq("user_id", bob.id)
        .single();
      expect(member?.roles).toEqual([]);

      // Invite row flipped to accepted with accepted_by_id set.
      const { data: inv } = await admin
        .from("group_invites")
        .select("status, accepted_by_id")
        .eq("token", token)
        .single();
      expect(inv?.status).toBe("accepted");
      expect(inv?.accepted_by_id).toBe(bob.id);

      // Idempotent: re-accepting returns already_accepted, and does
      // NOT echo group_id back — otherwise a leaked URL could be
      // replayed to confirm which group a stale invite points to
      // without ever passing the email-match gate.
      const dup = await bob.client.rpc("accept_group_invite", {
        p_token: token,
      });
      expect((dup.data as { already_accepted?: boolean } | null)?.already_accepted).toBe(
        true
      );
      expect((dup.data as { group_id?: string } | null)?.group_id).toBeUndefined();

      await admin.from("groups").delete().eq("id", groupId);
    });

    // Hardening for accept_group_invite: redeeming a low-privilege
    // invite must NOT strip roles a user already holds. The ON CONFLICT
    // DO NOTHING path preserves the existing role set.
    it("accept_group_invite does not overwrite an existing member's roles", async () => {
      const admin = adminClient();
      const { data: grp } = await alice.client
        .from("groups")
        .insert({ name: "Invite Role Preserve Test", owner_id: alice.id })
        .select("id")
        .single();
      const groupId = grp!.id;

      // Bob is already a manager (e.g. promoted out-of-band before
      // the older invite is redeemed).
      await admin.from("group_members").upsert(
        { group_id: groupId, user_id: bob.id, roles: ["manager"] },
        { onConflict: "group_id,user_id" }
      );

      const { data: bobAuth } = await admin.auth.admin.getUserById(bob.id);
      const bobEmail = bobAuth.user!.email!;
      const token =
        "invite-role-" +
        Date.now() +
        "-" +
        Math.random().toString(36).slice(2, 8);
      await admin.from("group_invites").insert({
        group_id: groupId,
        email: bobEmail,
        invited_by_id: alice.id,
        token,
        roles: [],
        expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      });

      const ok = await bob.client.rpc("accept_group_invite", { p_token: token });
      expect(ok.error).toBeNull();

      const { data: member } = await admin
        .from("group_members")
        .select("roles")
        .eq("group_id", groupId)
        .eq("user_id", bob.id)
        .single();
      expect(member?.roles).toEqual(["manager"]);

      await admin.from("groups").delete().eq("id", groupId);
    });

    // Bootstrap chicken-and-egg fix — a brand-new group owner used to
    // get rejected when they tried to self-add to group_members
    // (group_members_insert_manager requires has_group_role, which has
    // no row to read yet). The auto_add_group_owner_member trigger now
    // writes the owner row when the groups row lands; the same user
    // can then add additional members under the same RLS.
    it("creating a group auto-adds the owner as group_member", async () => {
      const { data: grp, error } = await alice.client
        .from("groups")
        .insert({ name: "Self-Bootstrap Test", owner_id: alice.id })
        .select("id")
        .single();
      expect(error).toBeNull();
      const groupId = grp!.id;

      const { data: ownerRow } = await alice.client
        .from("group_members")
        .select("roles")
        .eq("group_id", groupId)
        .eq("user_id", alice.id)
        .single();
      // Auto-added owner row carries an empty role set (owner powers come
      // from groups.owner_id, not the roles array).
      expect(ownerRow?.roles).toEqual([]);

      // The new owner can now add a friend without RLS rejection.
      const { error: addErr } = await alice.client
        .from("group_members")
        .insert({ group_id: groupId, user_id: bob.id, roles: [] });
      expect(addErr).toBeNull();

      const { data: members } = await alice.client
        .from("group_members")
        .select("user_id")
        .eq("group_id", groupId);
      expect(new Set((members ?? []).map((m) => m.user_id))).toEqual(
        new Set([alice.id, bob.id])
      );

      await alice.client.from("groups").delete().eq("id", groupId);
    });

    // Tournament — seed_event_bracket RPC inserts round-1 matches and
    // is organizer-only + idempotent.
    it("seed_event_bracket inserts round-1 matches; non-organizer rejected", async () => {
      const admin = adminClient();
      const { data: ev } = await alice.client
        .from("events")
        .insert({
          owner_id: alice.id,
          title: "Bracket Seed Test",
          event_type: "tournament",
          start_date: new Date(Date.now() + 86_400_000).toISOString(),
          end_date: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          visibility: "public",
          is_public_signup: true,
        })
        .select("id")
        .single();
      const eventId = ev!.id;
      // Both players need to be registered.
      await admin.from("event_participants").insert([
        { event_id: eventId, user_id: alice.id, status: "registered" },
        { event_id: eventId, user_id: bob.id, status: "registered" },
      ]);

      const denied = await bob.client.rpc("seed_event_bracket", {
        p_event_id: eventId,
        p_pairs: [[alice.id, bob.id]],
      });
      expect(denied.error?.message).toContain("organizer");

      const ok = await alice.client.rpc("seed_event_bracket", {
        p_event_id: eventId,
        p_pairs: [[alice.id, bob.id]],
      });
      expect(ok.error).toBeNull();
      expect((ok.data as { seeded?: number } | null)?.seeded).toBe(1);

      const { data: matches } = await admin
        .from("event_matches")
        .select("bracket_slot, status, player1_id, player2_id, round")
        .eq("event_id", eventId);
      expect((matches ?? []).length).toBe(1);
      expect(matches![0].bracket_slot).toBe("R1-1");
      expect(matches![0].round).toBe(1);
      expect(matches![0].status).toBe("scheduled");

      // Idempotency.
      const second = await alice.client.rpc("seed_event_bracket", {
        p_event_id: eventId,
        p_pairs: [[alice.id, bob.id]],
      });
      expect(second.error?.message).toContain("already seeded");

      await admin.from("events").delete().eq("id", eventId);
    });

    // H1 — bye matches auto-advance. The seed_event_bracket call
    // inserts a bye as status='completed' with winner_side=1; the
    // AFTER UPDATE advance trigger doesn't fire on INSERT, so the
    // function calls advance_event_match_to_next_round inline.
    it("seed_event_bracket auto-advances a bye into the next round", async () => {
      const admin = adminClient();
      const { data: ev } = await alice.client
        .from("events")
        .insert({
          owner_id: alice.id,
          title: "Bye Cascade Test",
          event_type: "tournament",
          start_date: new Date(Date.now() + 86_400_000).toISOString(),
          end_date: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          visibility: "public",
          is_public_signup: true,
        })
        .select("id")
        .single();
      const eventId = ev!.id;
      // Three players → bracket size 4; #1 seed gets a bye.
      await admin.from("event_participants").insert([
        { event_id: eventId, user_id: alice.id, status: "registered" },
        { event_id: eventId, user_id: bob.id, status: "registered" },
        { event_id: eventId, user_id: carol.id, status: "registered" },
      ]);

      const ok = await alice.client.rpc("seed_event_bracket", {
        p_event_id: eventId,
        // Pairs from seedBracket(['alice','bob','carol']):
        // [[alice, null], [bob, carol]] (alice gets the bye)
        p_pairs: [[alice.id, null], [bob.id, carol.id]],
      });
      expect(ok.error).toBeNull();
      expect((ok.data as { seeded?: number } | null)?.seeded).toBe(2);

      // After seeding: alice should be promoted to R2-1 as player1.
      const { data: r2 } = await admin
        .from("event_matches")
        .select("player1_id, player2_id, bracket_slot, round, status")
        .eq("event_id", eventId)
        .eq("bracket_slot", "R2-1")
        .maybeSingle();
      expect(r2).toBeTruthy();
      expect(r2!.player1_id).toBe(alice.id);
      expect(r2!.round).toBe(2);

      await admin.from("events").delete().eq("id", eventId);
    });

    // Round-robin — generate_round_robin_schedule inserts every round
    // at once, organizer-only, refuses re-runs, and gates to round_robin
    // events. With 3 players the circle method produces 3 rounds × 1
    // match (one player sits the bye each round).
    it("generate_round_robin_schedule inserts every round; organizer-only and idempotent", async () => {
      const admin = adminClient();
      const { data: ev } = await alice.client
        .from("events")
        .insert({
          owner_id: alice.id,
          title: "RR Schedule Test",
          event_type: "round_robin",
          start_date: new Date(Date.now() + 86_400_000).toISOString(),
          end_date: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          visibility: "public",
          is_public_signup: true,
        })
        .select("id")
        .single();
      const eventId = ev!.id;
      await admin.from("event_participants").insert([
        { event_id: eventId, user_id: alice.id, status: "registered" },
        { event_id: eventId, user_id: bob.id, status: "registered" },
        { event_id: eventId, user_id: carol.id, status: "registered" },
      ]);

      // Schedule from roundRobinSinglesSchedule([alice, bob, carol]):
      // 3 rounds, 1 pair each, the remaining player sits the bye.
      const schedule = [
        { round: 1, pairs: [[bob.id, carol.id]], bye: alice.id },
        { round: 2, pairs: [[alice.id, carol.id]], bye: bob.id },
        { round: 3, pairs: [[alice.id, bob.id]], bye: carol.id },
      ];

      // Non-organizer is rejected.
      const denied = await bob.client.rpc("generate_round_robin_schedule", {
        p_event_id: eventId,
        p_schedule: schedule as unknown as never,
      });
      expect(denied.error?.message).toContain("organizer");

      const ok = await alice.client.rpc("generate_round_robin_schedule", {
        p_event_id: eventId,
        p_schedule: schedule as unknown as never,
      });
      expect(ok.error).toBeNull();
      const okData = ok.data as { rounds?: number; matches?: number } | null;
      expect(okData?.rounds).toBe(3);
      expect(okData?.matches).toBe(3);

      const { data: matches } = await admin
        .from("event_matches")
        .select("round, status, player1_id, player2_id")
        .eq("event_id", eventId)
        .order("round", { ascending: true });
      expect((matches ?? []).length).toBe(3);
      expect(matches!.every((m) => m.status === "scheduled")).toBe(true);
      // Every pair must be unique — the whole point of round-robin.
      const seen = new Set<string>();
      for (const m of matches!) {
        const key = [m.player1_id, m.player2_id].sort().join("|");
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }

      // Idempotent: a second call refuses.
      const second = await alice.client.rpc("generate_round_robin_schedule", {
        p_event_id: eventId,
        p_schedule: schedule as unknown as never,
      });
      expect(second.error?.message).toContain("already generated");

      await admin.from("events").delete().eq("id", eventId);
    });

    // Round-robin RPC also gates by event_type so a non-RR event with
    // an organizer-fired call still gets rejected.
    it("generate_round_robin_schedule rejects non-round-robin events", async () => {
      const admin = adminClient();
      const { data: ev } = await alice.client
        .from("events")
        .insert({
          owner_id: alice.id,
          title: "RR Wrong Type Test",
          event_type: "mixer",
          start_date: new Date(Date.now() + 86_400_000).toISOString(),
          end_date: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          visibility: "public",
          is_public_signup: true,
        })
        .select("id")
        .single();
      const eventId = ev!.id;
      const wrong = await alice.client.rpc("generate_round_robin_schedule", {
        p_event_id: eventId,
        p_schedule: [
          { round: 1, pairs: [[alice.id, bob.id]], bye: null },
        ] as unknown as never,
      });
      expect(wrong.error?.message).toContain("round-robin");
      await admin.from("events").delete().eq("id", eventId);
    });

    // Ladder — seed_ladder_lineup ranks by NTRP desc, is organizer-
    // only + idempotent, and the propose_ladder_challenge gap check
    // then reads from ladder_rank instead of points. handle_ladder_
    // match_completion swaps rungs when a lower-ranked player wins.
    it("seed_ladder_lineup ranks by NTRP and rungs swap on a lower-ranked win", async () => {
      const admin = adminClient();
      // Pin NTRP so the seeded order is predictable: bob (4.0) > alice
      // (3.5) > carol (3.0). bob ends at rung 1, alice at rung 2,
      // carol at rung 3.
      await admin.from("profiles").update({ ntrp_rating: 3.5 }).eq("id", alice.id);
      await admin.from("profiles").update({ ntrp_rating: 4.0 }).eq("id", bob.id);
      await admin.from("profiles").update({ ntrp_rating: 3.0 }).eq("id", carol.id);

      const { data: ev } = await alice.client
        .from("events")
        .insert({
          owner_id: alice.id,
          title: "Ladder Seed Test",
          event_type: "ladder",
          start_date: new Date(Date.now() + 86_400_000).toISOString(),
          end_date: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          visibility: "public",
          is_public_signup: true,
        })
        .select("id")
        .single();
      const eventId = ev!.id;
      await admin.from("event_participants").insert([
        { event_id: eventId, user_id: alice.id, status: "registered" },
        { event_id: eventId, user_id: bob.id, status: "registered" },
        { event_id: eventId, user_id: carol.id, status: "registered" },
      ]);

      // Non-organizer is rejected.
      const denied = await bob.client.rpc("seed_ladder_lineup", {
        p_event_id: eventId,
      });
      expect(denied.error?.message).toContain("organizer");

      const ok = await alice.client.rpc("seed_ladder_lineup", {
        p_event_id: eventId,
      });
      expect(ok.error).toBeNull();
      expect((ok.data as { seeded?: number } | null)?.seeded).toBe(3);

      const { data: ranks } = await admin
        .from("event_participants")
        .select("user_id, ladder_rank")
        .eq("event_id", eventId);
      const rankByUser = new Map(
        (ranks ?? []).map((r) => [r.user_id, r.ladder_rank])
      );
      expect(rankByUser.get(bob.id)).toBe(1);
      expect(rankByUser.get(alice.id)).toBe(2);
      expect(rankByUser.get(carol.id)).toBe(3);

      // Re-seeding refuses.
      const second = await alice.client.rpc("seed_ladder_lineup", {
        p_event_id: eventId,
      });
      expect(second.error?.message).toContain("already seeded");

      // Carol (rung 3) challenges alice (rung 2) — within the default
      // max gap of 3. The challenge inserts a 'proposed' match.
      const challenge = await carol.client.rpc("propose_ladder_challenge", {
        p_event_id: eventId,
        p_opponent_id: alice.id,
      });
      expect(challenge.error).toBeNull();
      const matchId = challenge.data as string;

      // Accept, complete, and report carol as the winner. The trigger
      // should swap rungs so carol ends at 2, alice at 3.
      await admin
        .from("event_matches")
        .update({ status: "scheduled" })
        .eq("id", matchId);
      await admin
        .from("event_matches")
        .update({
          score: "6-4,6-3",
          // propose_ladder_challenge puts the challenger (carol) at
          // player1 and the opponent (alice) at player2, so a carol
          // win is winner_side=1.
          winner_side: 1,
          status: "completed",
        })
        .eq("id", matchId);

      const { data: ranksAfter } = await admin
        .from("event_participants")
        .select("user_id, ladder_rank")
        .eq("event_id", eventId);
      const afterByUser = new Map(
        (ranksAfter ?? []).map((r) => [r.user_id, r.ladder_rank])
      );
      expect(afterByUser.get(carol.id)).toBe(2);
      expect(afterByUser.get(alice.id)).toBe(3);
      expect(afterByUser.get(bob.id)).toBe(1);

      await admin.from("events").delete().eq("id", eventId);
      // Reset NTRP to keep other tests independent.
      await admin.from("profiles").update({ ntrp_rating: null }).eq("id", alice.id);
      await admin.from("profiles").update({ ntrp_rating: null }).eq("id", bob.id);
      await admin.from("profiles").update({ ntrp_rating: null }).eq("id", carol.id);
    });

    // Tournament — advance_tournament_winner advances the round-1
    // winner into the final slot. (No backing group chat means no
    // champion announcement to assert on; the bracket-state change is
    // the contract.)
    it("advance_tournament_winner advances the winner to the final", async () => {
      const admin = adminClient();
      const { data: ev } = await alice.client
        .from("events")
        .insert({
          owner_id: alice.id,
          title: "Bracket Advance Test",
          event_type: "tournament",
          start_date: new Date(Date.now() + 86_400_000).toISOString(),
          end_date: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          visibility: "public",
          is_public_signup: true,
        })
        .select("id")
        .single();
      const eventId = ev!.id;

      await admin.from("event_participants").insert([
        { event_id: eventId, user_id: alice.id, status: "registered" },
        { event_id: eventId, user_id: bob.id, status: "registered" },
      ]);

      // Two-player tournament: seed one round-1 match, which is the
      // final. Completing it should mark the bracket done.
      const seeded = await alice.client.rpc("seed_event_bracket", {
        p_event_id: eventId,
        p_pairs: [[alice.id, bob.id]],
      });
      expect(seeded.error).toBeNull();
      const { data: matchRow } = await admin
        .from("event_matches")
        .select("id")
        .eq("event_id", eventId)
        .eq("bracket_slot", "R1-1")
        .single();
      const matchId = matchRow!.id;

      // alice reports + bob confirms (the existing flow).
      await alice.client
        .from("event_matches")
        .update({
          score: "6-4,6-3",
          winner_side: 1,
          reported_by: alice.id,
          status: "in_progress",
        })
        .eq("id", matchId);
      await bob.client
        .from("event_matches")
        .update({ confirmed_by: bob.id, status: "completed" })
        .eq("id", matchId);

      // The final completing should not spawn a phantom R2 row.
      const { data: r2 } = await admin
        .from("event_matches")
        .select("id")
        .eq("event_id", eventId)
        .eq("round", 2);
      expect((r2 ?? []).length).toBe(0);

      await admin.from("events").delete().eq("id", eventId);
    });

    // C2 — actor-column impersonation gate. Bob (player2) cannot set
    // reported_by to alice's id; the BEFORE UPDATE trigger rejects.
    it("event_matches BEFORE UPDATE blocks actor-column impersonation", async () => {
      const admin = adminClient();
      // Two-player tournament event with both players registered so
      // SELECT RLS lets each see the match row.
      const { data: ev } = await alice.client
        .from("events")
        .insert({
          owner_id: alice.id,
          title: "Actor Gate Test",
          event_type: "tournament",
          start_date: new Date(Date.now() + 86_400_000).toISOString(),
          end_date: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          visibility: "public",
          is_public_signup: true,
        })
        .select("id")
        .single();
      const eventId = ev!.id;
      await admin.from("event_participants").insert([
        { event_id: eventId, user_id: alice.id, status: "registered" },
        { event_id: eventId, user_id: bob.id, status: "registered" },
      ]);
      const { data: m } = await alice.client
        .from("event_matches")
        .insert({
          event_id: eventId,
          player1_id: alice.id,
          player2_id: bob.id,
          status: "scheduled",
        })
        .select("id")
        .single();
      const matchId = m!.id;

      // Bob tries to report a score in alice's name. Trigger rejects.
      const evilReport = await bob.client
        .from("event_matches")
        .update({
          score: "6-0,6-0",
          winner_side: 2,
          reported_by: alice.id,
          status: "in_progress",
        })
        .eq("id", matchId);
      expect(evilReport.error?.message).toContain("reported_by must be the caller");

      // Bob reporting in his own name still works.
      const okReport = await bob.client
        .from("event_matches")
        .update({
          score: "6-3,6-4",
          winner_side: 2,
          reported_by: bob.id,
          status: "in_progress",
        })
        .eq("id", matchId);
      expect(okReport.error).toBeNull();

      // Bob trying to confirm in alice's name fails too.
      const evilConfirm = await bob.client
        .from("event_matches")
        .update({ confirmed_by: alice.id, status: "completed" })
        .eq("id", matchId);
      expect(evilConfirm.error?.message).toContain("confirmed_by must be the caller");

      await alice.client.from("events").delete().eq("id", eventId);
    });

    // H1 / H2 — actor gate also locks winner_side + score for non-
    // owner players. Combined with the reported_by gate, this means
    // a non-owner can only write a score by claiming the report.
    it("event_matches actor gate locks score/winner_side to the reporter", async () => {
      const admin = adminClient();
      const { data: ev } = await alice.client
        .from("events")
        .insert({
          owner_id: alice.id,
          title: "Score Lock Test",
          event_type: "tournament",
          start_date: new Date(Date.now() + 86_400_000).toISOString(),
          end_date: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          visibility: "public",
          is_public_signup: true,
        })
        .select("id")
        .single();
      const eventId = ev!.id;
      await admin.from("event_participants").insert([
        { event_id: eventId, user_id: alice.id, status: "registered" },
        { event_id: eventId, user_id: bob.id, status: "registered" },
      ]);
      const { data: m } = await alice.client
        .from("event_matches")
        .insert({
          event_id: eventId,
          player1_id: alice.id,
          player2_id: bob.id,
          status: "scheduled",
        })
        .select("id")
        .single();
      const matchId = m!.id;

      // Bob tries to write score WITHOUT claiming the report.
      // Should be rejected because reported_by isn't set to him.
      const bareWrite = await bob.client
        .from("event_matches")
        .update({ score: "6-0,6-0", winner_side: 2 })
        .eq("id", matchId);
      expect(bareWrite.error?.message).toContain("reporter or event owner");

      // Bob writes score AND claims report -> allowed.
      const reportOk = await bob.client
        .from("event_matches")
        .update({
          score: "6-3,6-4",
          winner_side: 2,
          reported_by: bob.id,
          status: "in_progress",
        })
        .eq("id", matchId);
      expect(reportOk.error).toBeNull();

      await alice.client.from("events").delete().eq("id", eventId);
    });

    // H2 — actor gate also catches proposed_by impersonation on the
    // initial propose insert (via the propose_ladder_challenge RPC,
    // which is the only path that writes proposed_by).
    it("propose_ladder_challenge RPC writes proposed_by = caller", async () => {
      const admin = adminClient();
      const { data: ev } = await alice.client
        .from("events")
        .insert({
          owner_id: alice.id,
          title: "Ladder Proposed-By Test",
          event_type: "ladder",
          start_date: new Date(Date.now() + 86_400_000).toISOString(),
          end_date: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          visibility: "public",
          is_public_signup: true,
          config: { ladderMaxGap: 99 },
        })
        .select("id")
        .single();
      const eventId = ev!.id;
      await admin.from("event_participants").insert([
        { event_id: eventId, user_id: alice.id, status: "registered" },
        { event_id: eventId, user_id: bob.id, status: "registered" },
        { event_id: eventId, user_id: carol.id, status: "registered" },
      ]);
      // Seed a completed match so alice has a clear #1 rank.
      await admin.from("event_matches").insert({
        event_id: eventId,
        player1_id: alice.id,
        player2_id: bob.id,
        status: "completed",
        score: "6-0,6-0",
        winner_side: 1,
      });

      // carol (#3) challenges someone ranked above. The RPC writes
      // proposed_by = caller server-side regardless of what the
      // client passes.
      const result = await carol.client.rpc("propose_ladder_challenge", {
        p_event_id: eventId,
        p_opponent_id: alice.id,
      });
      expect(result.error).toBeNull();
      const matchId = result.data as string;
      const { data: match } = await admin
        .from("event_matches")
        .select("proposed_by")
        .eq("id", matchId)
        .single();
      expect(match?.proposed_by).toBe(carol.id);

      await alice.client.from("events").delete().eq("id", eventId);
    });

    // H5 — re-applying after a rejection sends a fresh join_request
    // notification to the post author.
    it("requestToJoin re-application sends a new join_request notification", async () => {
      const admin = adminClient();
      const post = await createPost(alice.client, {
        content: "Re-apply notify test",
        post_type: "find_players",
        play_date: "2026-09-15",
        play_time: "14:00",
        play_duration: 90,
        play_timezone: "America/Los_Angeles",
        court_location: "Lower Woodland",
        game_type: "singles",
        players_needed: 1,
      });
      // First request, alice rejects.
      const { data: req } = await admin
        .from("play_requests")
        .insert({ post_id: post.id, user_id: bob.id, status: "pending" })
        .select("id")
        .single();
      await admin
        .from("play_requests")
        .update({ status: "rejected" })
        .eq("id", req!.id);

      // Clear notifications so the assertion only sees the re-apply one.
      await admin
        .from("notifications")
        .delete()
        .eq("user_id", alice.id)
        .eq("type", "join_request")
        .eq("post_id", post.id);

      const { requestToJoin } = await import("../../src/lib/supabase/queries");
      await requestToJoin(bob.client, post.id, "second try");

      const { data: notes } = await admin
        .from("notifications")
        .select("type, actor_id, post_id")
        .eq("user_id", alice.id)
        .eq("type", "join_request")
        .eq("post_id", post.id);
      expect((notes ?? []).length).toBe(1);
      expect(notes![0].actor_id).toBe(bob.id);

      await deletePost(alice.client, post.id);
    });

    // Ladder — propose_ladder_challenge enforces rank-gap + dedupe.
    it("propose_ladder_challenge respects rank-gap + dedupe", async () => {
      const admin = adminClient();
      const { data: ev } = await alice.client
        .from("events")
        .insert({
          owner_id: alice.id,
          title: "Ladder Test",
          event_type: "ladder",
          start_date: new Date(Date.now() + 86_400_000).toISOString(),
          end_date: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          visibility: "public",
          is_public_signup: true,
          config: { ladderMaxGap: 1 },
        })
        .select("id")
        .single();
      const eventId = ev!.id;

      // Three registered: alice, bob, carol. With no completed matches,
      // ranks tie on points → tie-break falls to user_id.localeCompare.
      // Seed an alice-vs-carol completed match so alice has a clear
      // #1 rank and bob is below her.
      await admin.from("event_participants").insert([
        { event_id: eventId, user_id: alice.id, status: "registered" },
        { event_id: eventId, user_id: bob.id, status: "registered" },
        { event_id: eventId, user_id: carol.id, status: "registered" },
      ]);
      await admin.from("event_matches").insert({
        event_id: eventId,
        player1_id: alice.id,
        player2_id: carol.id,
        status: "completed",
        score: "6-0,6-0",
        winner_side: 1,
      });
      // recompute_event_standings_trigger fires on that INSERT.

      // alice is #1 (3 pts). bob has 0 pts, carol has 0 pts. tiebreak by user_id.
      // Lower-ranked challenging higher-ranked: bob -> alice. With ladderMaxGap=1,
      // bob's rank - alice's rank = 1 → permitted only if bob is exactly 1 below.
      // Find bob's actual rank.
      const { data: parts } = await admin
        .from("event_participants")
        .select("user_id, points, losses, sets_won, sets_lost")
        .eq("event_id", eventId);
      const sorted = (parts ?? [])
        .map((p) => ({ ...p }))
        .sort((a, b) => {
          if (b.points !== a.points) return b.points - a.points;
          const setDiffA = a.sets_won - a.sets_lost;
          const setDiffB = b.sets_won - b.sets_lost;
          if (setDiffB !== setDiffA) return setDiffB - setDiffA;
          if (a.losses !== b.losses) return a.losses - b.losses;
          return a.user_id.localeCompare(b.user_id);
        });
      const bobRank = sorted.findIndex((p) => p.user_id === bob.id) + 1;
      const aliceRank = sorted.findIndex((p) => p.user_id === alice.id) + 1;
      const carolRank = sorted.findIndex((p) => p.user_id === carol.id) + 1;

      // Same-rank challenge -> rejected.
      const same = await bob.client.rpc("propose_ladder_challenge", {
        p_event_id: eventId,
        p_opponent_id: bobRank === carolRank ? carol.id : bob.id,
      });
      // Either same-rank ("only challenge above") or self ("valid opponent");
      // both rejections are valid here.
      expect(same.error).not.toBeNull();

      // Bob challenges alice. Allowed only if alice is exactly within 1 rank.
      // If alice is ranked > 1 ahead of bob, expect a rank-gap error.
      const aliceChallenge = await bob.client.rpc("propose_ladder_challenge", {
        p_event_id: eventId,
        p_opponent_id: alice.id,
      });
      if (bobRank - aliceRank > 1) {
        expect(aliceChallenge.error?.message).toContain("Challenge limited");
      } else if (bobRank > aliceRank) {
        expect(aliceChallenge.error).toBeNull();
      }

      // Dedupe: lowest-ranked player picks the next-higher player and
      // challenges twice; second call must reject with "open match".
      const lowest = sorted[sorted.length - 1];
      const nextUp = sorted[sorted.length - 2];
      const lowestClient =
        lowest.user_id === alice.id ? alice.client :
        lowest.user_id === bob.id ? bob.client : carol.client;
      const first = await lowestClient.rpc("propose_ladder_challenge", {
        p_event_id: eventId,
        p_opponent_id: nextUp.user_id,
      });
      if (!first.error) {
        const dup = await lowestClient.rpc("propose_ladder_challenge", {
          p_event_id: eventId,
          p_opponent_id: nextUp.user_id,
        });
        expect(dup.error?.message).toContain("open match");
      }

      await admin.from("events").delete().eq("id", eventId);
    });

    // recompute_event_standings — completed match updates the
    // event_participants aggregate columns the StandingsTable reads.
    it("recompute_event_standings updates wins/losses/points", async () => {
      const admin = adminClient();
      const { data: ev } = await alice.client
        .from("events")
        .insert({
          owner_id: alice.id,
          title: "Standings Recompute",
          event_type: "round_robin",
          start_date: new Date(Date.now() + 86_400_000).toISOString(),
          end_date: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          visibility: "public",
          is_public_signup: true,
        })
        .select("id")
        .single();
      const eventId = ev!.id;
      await admin.from("event_participants").insert([
        { event_id: eventId, user_id: alice.id, status: "registered" },
        { event_id: eventId, user_id: bob.id, status: "registered" },
      ]);

      await admin.from("event_matches").insert({
        event_id: eventId,
        player1_id: alice.id,
        player2_id: bob.id,
        status: "completed",
        score: "6-4,6-3",
        winner_side: 1,
      });

      const { data: aliceRow } = await admin
        .from("event_participants")
        .select("wins, losses, points, sets_won, sets_lost")
        .eq("event_id", eventId)
        .eq("user_id", alice.id)
        .single();
      const { data: bobRow } = await admin
        .from("event_participants")
        .select("wins, losses, points, sets_won, sets_lost")
        .eq("event_id", eventId)
        .eq("user_id", bob.id)
        .single();
      expect(aliceRow?.wins).toBe(1);
      expect(aliceRow?.points).toBe(3);
      expect(aliceRow?.sets_won).toBe(2);
      expect(aliceRow?.sets_lost).toBe(0);
      expect(bobRow?.losses).toBe(1);
      expect(bobRow?.points).toBe(0);
      expect(bobRow?.sets_won).toBe(0);
      expect(bobRow?.sets_lost).toBe(2);

      await admin.from("events").delete().eq("id", eventId);
    });

    // G15 — listUpcomingFindPlayersGames surfaces every open
    // find_players post the caller authors OR is APPROVED on, drops
    // anything whose end-time has already passed, and de-dupes.
    //
    // PostComposer stores play_date / play_time as local-zone
    // "YYYY-MM-DD" / "HH:mm" strings; the query reconstructs the
    // local-zone Date the same way (no Z suffix). The test builds
    // those strings via the same local-zone math.
    function localParts(d: Date): { date: string; time: string } {
      const pad = (n: number) => String(n).padStart(2, "0");
      return {
        date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      };
    }

    it("listUpcomingFindPlayersGames returns games the caller is in", async () => {
      const admin = adminClient();
      const inFuture = new Date(Date.now() + 30 * 60_000);
      const fut = localParts(inFuture);

      const authored = await createPost(alice.client, {
        content: "Need 1 more",
        post_type: "find_players",
        play_date: fut.date,
        play_time: fut.time,
        play_duration: 90,
        court_location: "Lower Woodland",
        game_type: "singles",
        players_needed: 1,
      });
      const otherPost = await createPost(bob.client, {
        content: "Need 2 more",
        post_type: "find_players",
        play_date: fut.date,
        play_time: fut.time,
        play_duration: 90,
        court_location: "Lower Woodland",
        game_type: "doubles",
        // 2 needed so approving alice doesn't auto-complete the post
        // (the recount trigger would flip is_complete=true and
        // listUpcomingFindPlayersGames filters on is_complete=false).
        players_needed: 2,
      });
      // Approve alice into bob's game so it should also show up.
      await admin.from("play_requests").insert({
        post_id: otherPost.id,
        user_id: alice.id,
        status: "approved",
      });

      const games = await listUpcomingFindPlayersGames(alice.client);
      const ids = games.map((g) => g.postId);
      expect(ids).toEqual(expect.arrayContaining([authored.id, otherPost.id]));

      // A find_players post that has already ended must be dropped.
      const past = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const pp = localParts(past);
      const expired = await createPost(alice.client, {
        content: "Yesterday",
        post_type: "find_players",
        play_date: pp.date,
        play_time: pp.time,
        play_duration: 60,
        court_location: "Lower Woodland",
        game_type: "singles",
        players_needed: 1,
      });
      const after = await listUpcomingFindPlayersGames(alice.client);
      expect(after.map((g) => g.postId)).not.toContain(expired.id);

      await deletePost(alice.client, authored.id);
      await deletePost(bob.client, otherPost.id);
      await deletePost(alice.client, expired.id);
    });

    // U6 — creating a practice_series row posts an announcement into
    // the group chat attributed to the creator.
    it("practice series creation announces in the group chat", async () => {
      // groups_auto_add_owner adds alice's owner row automatically;
      // we can create the group as alice directly.
      const { data: grp } = await alice.client
        .from("groups")
        .insert({ name: "Practice Announce Test", owner_id: alice.id })
        .select("id")
        .single();
      const groupId = grp!.id;

      const { data: series } = await alice.client
        .from("practice_series")
        .insert({
          group_id: groupId,
          name: "Sunday Drills",
          location: "Lower Woodland",
          practice_time: "Sun 9am",
        })
        .select("id")
        .single();
      expect(series?.id).toBeTruthy();

      const { data: msgs } = await alice.client
        .from("group_messages")
        .select("content, sender_id")
        .eq("group_id", groupId)
        .order("created_at", { ascending: false })
        .limit(1);
      expect((msgs ?? []).length).toBe(1);
      expect(msgs![0].content).toContain("New practice series");
      expect(msgs![0].content).toContain("Sunday Drills");
      expect(msgs![0].content).toContain("Lower Woodland");
      expect(msgs![0].sender_id).toBe(alice.id);

      await alice.client.from("groups").delete().eq("id", groupId);
    });

    // G16 — report_court_availability RPC: participant gate, window
    // check, per-user dedupe.
    it("report_court_availability RPC enforces participant + window + dedupe", async () => {
      // Game starts now -> within the 30 min before / end window.
      // Use UTC strings + play_timezone='UTC' so the trigger's
      // wall-clock-in-zone parse round-trips to the same UTC instant
      // as the test machine's `now`.
      const today = new Date();
      const playDate = today.toISOString().slice(0, 10);
      const playTime = today.toISOString().slice(11, 16);

      const post = await createPost(alice.client, {
        content: "Going to play",
        post_type: "find_players",
        play_date: playDate,
        play_time: playTime,
        play_duration: 90,
        play_timezone: "UTC",
        court_location: "Test Court",
        game_type: "singles",
        players_needed: 1,
      });
      const courtId = `tf-test-${post.id.slice(0, 8)}`;

      // bob isn't a participant -> denied.
      const denied = await bob.client.rpc("report_court_availability", {
        p_court_id: courtId,
        p_has_empty: true,
        p_post_id: post.id,
      });
      expect(denied.error?.message).toContain("Not a participant");

      // alice is the author -> accepted.
      const ok = await alice.client.rpc("report_court_availability", {
        p_court_id: courtId,
        p_has_empty: true,
        p_post_id: post.id,
      });
      expect(ok.error).toBeNull();
      expect((ok.data as { ok: boolean; deduped?: boolean }).deduped).toBeFalsy();

      // Same court same user within 30 min -> deduped.
      const dup = await alice.client.rpc("report_court_availability", {
        p_court_id: courtId,
        p_has_empty: false,
        p_post_id: post.id,
      });
      expect((dup.data as { deduped?: boolean }).deduped).toBe(true);

      await adminClient()
        .from("court_availability_reports")
        .delete()
        .eq("court_id", courtId);
      await deletePost(alice.client, post.id);
    });
  });
});
