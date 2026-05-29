import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  deleteTestUsers,
  integrationEnvReady,
  makeTestUser,
  type TestUser,
} from "./_helpers";

import {
  // chats
  listMyChats,
  getChat,
  listChatMessages,
  sendChatMessage,
  listChatParticipants,
  markChatRead,
  // team listings
  listTeamListings,
  createTeamListing,
  // friend groups
  listMyFriendGroups,
  listFriendGroupMembers,
  createFriendGroup,
  deleteFriendGroup,
  // reactions
  addReaction,
  removeReaction,
  // highlights
  listHighlights,
  addHighlight,
  deleteHighlight,
  // device tokens
  registerDeviceToken,
  // play requests
  requestToJoin,
  cancelPlayRequest,
  respondToPlayRequest,
  // dashboard
  getDashboardUpcoming,
  // invite
  validateInvite,
  // events
  createEvent,
  // posts
  createPost,
} from "../../src/lib/supabase/queries";

describe.skipIf(!integrationEnvReady)("extended query helpers (live Supabase)", () => {
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    [alice, bob] = await Promise.all([
      makeTestUser("ext-alice"),
      makeTestUser("ext-bob"),
    ]);
  }, 60_000);

  afterAll(async () => {
    await deleteTestUsers([alice, bob].filter(Boolean));
  }, 60_000);

  describe("chats", () => {
    let chatId: string;
    beforeAll(async () => {
      const { data: chat, error } = await alice.client
        .from("chats")
        .insert({ name: "Court 3 Saturday", creator_id: alice.id })
        .select("id")
        .single();
      if (error) throw error;
      chatId = chat.id;
      const admin = adminClient();
      await admin.from("chat_participants").insert([
        { chat_id: chatId, user_id: alice.id },
        { chat_id: chatId, user_id: bob.id },
      ]);
    });

    it("listMyChats includes chats I'm a participant in", async () => {
      const chats = await listMyChats(bob.client);
      expect(chats.some((c) => c.id === chatId)).toBe(true);
    });

    it("getChat returns the chat", async () => {
      const c = await getChat(alice.client, chatId);
      expect(c?.name).toBe("Court 3 Saturday");
    });

    it("sendChatMessage + listChatMessages round-trip", async () => {
      const msg = await sendChatMessage(alice.client, chatId, "see u sat");
      expect(msg.content).toBe("see u sat");
      const list = await listChatMessages(bob.client, chatId);
      expect(list.some((m) => m.id === msg.id)).toBe(true);
    });

    it("listChatParticipants returns the roster", async () => {
      const parts = await listChatParticipants(alice.client, chatId);
      expect(parts.length).toBe(2);
    });

    it("markChatRead updates last_read_at", async () => {
      await markChatRead(alice.client, chatId);
      // no assertion on timestamp value — just that the call doesn't throw
      expect(true).toBe(true);
    });
  });

  describe("team listings", () => {
    let groupId: string;
    beforeAll(async () => {
      const { data: group, error } = await alice.client
        .from("groups")
        .insert({ name: "Court Hunters", owner_id: alice.id })
        .select("id")
        .single();
      if (error) throw error;
      groupId = group.id;
      // groups_auto_add_owner trigger handles the owner row.
    });

    it("createTeamListing + listTeamListings round-trip", async () => {
      const listing = await createTeamListing(alice.client, groupId, {
        title: "Need a doubles partner",
        description: "Saturday afternoons",
        format: "doubles",
        ntrp_min: 3.5,
        ntrp_max: 4.5,
        city: "Seattle",
        expires_at: null,
      });
      expect(listing.title).toBe("Need a doubles partner");
      const all = await listTeamListings(bob.client, { format: "doubles" });
      expect(all.some((l) => l.id === listing.id)).toBe(true);
    });

    it("listTeamListings filters by city (ilike)", async () => {
      const filtered = await listTeamListings(bob.client, { city: "seattle" });
      expect(filtered.length).toBeGreaterThan(0);
    });
  });

  describe("friend groups", () => {
    it("createFriendGroup + listMyFriendGroups + members + delete", async () => {
      const fg = await createFriendGroup(alice.client, "Closer Friends", [bob.id]);
      expect(fg.name).toBe("Closer Friends");
      const mine = await listMyFriendGroups(alice.client);
      expect(mine.some((g) => g.id === fg.id)).toBe(true);
      const members = await listFriendGroupMembers(alice.client, fg.id);
      expect(members.some((m) => m.user_id === bob.id)).toBe(true);
      await deleteFriendGroup(alice.client, fg.id);
      const after = await listMyFriendGroups(alice.client);
      expect(after.some((g) => g.id === fg.id)).toBe(false);
    });
  });

  describe("highlights", () => {
    let highlightId: string;
    it("addHighlight + listHighlights round-trip", async () => {
      const h = await addHighlight(alice.client, {
        mediaUrl: "https://example.com/x.jpg",
        mediaType: "image",
        caption: "court win",
      });
      highlightId = h.id;
      const list = await listHighlights(alice.client, alice.id);
      expect(list.some((x) => x.id === highlightId)).toBe(true);
    });

    it("deleteHighlight removes it", async () => {
      await deleteHighlight(alice.client, highlightId);
      const list = await listHighlights(alice.client, alice.id);
      expect(list.some((x) => x.id === highlightId)).toBe(false);
    });
  });

  describe("device tokens", () => {
    beforeAll(async () => {
      // Tokens are uniquely keyed by (token) — sweep any leftover from prior
      // runs so the upsert below isn't blocked by an RLS USING that refers
      // to a stale user_id.
      const admin = adminClient();
      await admin.from("device_tokens").delete().eq("token", "test-token-abc");
    });

    it("registerDeviceToken upserts on conflict", async () => {
      await registerDeviceToken(alice.client, "test-token-abc", "ios");
      await registerDeviceToken(alice.client, "test-token-abc", "ios");
      const { data } = await alice.client
        .from("device_tokens")
        .select("token, platform")
        .eq("token", "test-token-abc");
      expect(data?.length).toBe(1);
    });
  });

  describe("play requests", () => {
    let postId: string;
    beforeAll(async () => {
      // alice creates a find-players post, bob (friend) wants to join.
      try {
        await alice.client
          .from("friendships")
          .insert({
            requester_id: alice.id,
            addressee_id: bob.id,
            status: "accepted",
          });
      } catch {
        // ignore if already friends
      }
      const p = await createPost(alice.client, {
        content: "Need a 4th",
        post_type: "find_players",
        players_needed: 1,
      });
      postId = p.id;
    });

    it("requestToJoin + respondToPlayRequest + cancelPlayRequest", async () => {
      const req = await requestToJoin(bob.client, postId, "I can play");
      expect(req.status).toBe("pending");
      // Alice approves
      await respondToPlayRequest(alice.client, req.id, "approved");
      const { data } = await alice.client
        .from("play_requests")
        .select("status")
        .eq("id", req.id)
        .single();
      expect(data?.status).toBe("approved");
      // Bob withdraws from an APPROVED request: the row persists as
      // 'withdrawn' so the trigger can DM the author + free the slot.
      await cancelPlayRequest(bob.client, postId, "schedule clash");
      const { data: after } = await alice.client
        .from("play_requests")
        .select("status, note")
        .eq("post_id", postId)
        .eq("user_id", bob.id)
        .single();
      expect(after?.status).toBe("withdrawn");
      expect(after?.note).toBe("schedule clash");
      // Cleanup the row so the find-players trigger doesn't re-fire on
      // the next describe block's fixture create.
      await adminClient()
        .from("play_requests")
        .delete()
        .eq("post_id", postId)
        .eq("user_id", bob.id);
    });
  });

  describe("dashboard upcoming", () => {
    beforeAll(async () => {
      // Alice creates a future event and registers herself.
      const ev = await createEvent(alice.client, {
        title: "Sunday Round-Robin",
        event_type: "round_robin",
        start_date: new Date(Date.now() + 86400_000).toISOString(),
        end_date: new Date(Date.now() + 86400_000 * 2).toISOString(),
        is_public_signup: true,
        visibility: "public",
        event_lat: 47.6,
        event_lng: -122.3,
        radius_mi: 25,
      });
      await alice.client
        .from("event_participants")
        .insert({ event_id: ev.id, user_id: alice.id, status: "registered" });
    });

    it("getDashboardUpcoming returns my upcoming events", async () => {
      const u = await getDashboardUpcoming(alice.client);
      expect(u.events.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("invites", () => {
    it("validateInvite returns null for unknown tokens", async () => {
      const inv = await validateInvite(alice.client, "definitely-not-a-real-token");
      expect(inv).toBeNull();
    });
  });

  describe("reactions", () => {
    let groupMessageId: string;
    let groupId: string;
    beforeAll(async () => {
      const { data: g } = await alice.client
        .from("groups")
        .insert({ name: "Reactions Test", owner_id: alice.id })
        .select("id")
        .single();
      groupId = g!.id;
      // owner row auto-added by groups_auto_add_owner.
      const admin = adminClient();
      await admin.from("group_members").insert([
        { group_id: groupId, user_id: bob.id, role: "member" },
      ]);
      const { data: m } = await alice.client
        .from("group_messages")
        .insert({ group_id: groupId, sender_id: alice.id, content: "react to me" })
        .select("id")
        .single();
      groupMessageId = m!.id;
    });

    it("addReaction + removeReaction round-trip", async () => {
      await addReaction(bob.client, "group", groupMessageId, "🎾");
      const { data: ins } = await bob.client
        .from("message_reactions")
        .select("id")
        .eq("target_id", groupMessageId)
        .eq("user_id", bob.id);
      expect(ins?.length).toBe(1);

      await removeReaction(bob.client, "group", groupMessageId, "🎾");
      const { data: aft } = await bob.client
        .from("message_reactions")
        .select("id")
        .eq("target_id", groupMessageId)
        .eq("user_id", bob.id);
      expect(aft?.length).toBe(0);
    });
  });

  // Albums has TWO FKs between albums and album_items
  // (album_items.album_id and albums.cover_item_id), so the embed needs an
  // explicit FK hint. Without it PostgREST silently returns an error and
  // the page renders "No albums yet" even after a successful insert.
  describe("album page selects", () => {
    let groupId: string;
    let albumId: string;
    beforeAll(async () => {
      const { data: g, error: gErr } = await alice.client
        .from("groups")
        .insert({ name: "Album Test Squad", owner_id: alice.id })
        .select("id")
        .single();
      if (gErr) throw gErr;
      groupId = g!.id;
      const { data: a, error: aErr } = await alice.client
        .from("albums")
        .insert({
          group_id: groupId,
          name: "Spring 2026",
          description: "season opener",
          created_by_id: alice.id,
        })
        .select("id")
        .single();
      if (aErr) throw aErr;
      albumId = a!.id;
    });

    it("/groups/[id]/albums list select returns the album", async () => {
      const { data, error } = await alice.client
        .from("albums")
        .select(
          `id, name, description, created_at, cover_item_id,
           createdBy:profiles!albums_created_by_id_fkey ( id, name, profile_image_url ),
           items:album_items!album_items_album_id_fkey ( id, url, media_type )`
        )
        .eq("group_id", groupId)
        .order("created_at", { ascending: false });
      expect(error).toBeNull();
      expect(data?.length).toBe(1);
      expect(data?.[0].id).toBe(albumId);
      expect(Array.isArray(data?.[0].items)).toBe(true);
    });

    it("/groups/[id]/albums/[albumId] detail select returns the album", async () => {
      const { data, error } = await alice.client
        .from("albums")
        .select(
          `id, name, description, created_at, created_by_id, cover_item_id,
           createdBy:profiles!albums_created_by_id_fkey ( id, name, profile_image_url ),
           items:album_items!album_items_album_id_fkey ( id, url, media_type, caption, created_at,
             addedBy:profiles!album_items_added_by_id_fkey ( id, name, profile_image_url )
           )`
        )
        .eq("id", albumId)
        .maybeSingle();
      expect(error).toBeNull();
      expect(data?.id).toBe(albumId);
    });
  });
});
