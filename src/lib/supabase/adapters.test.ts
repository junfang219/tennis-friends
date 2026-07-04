import { describe, expect, it } from "vitest";
import {
  toProfileCamel,
  toPostCamel,
  toCommentCamel,
  toEventCamel,
  toGroupCamel,
  toGroupMessageCamel,
  toNotificationCamel,
  toDirectMessageCamel,
  toChatMessageCamel,
  toTeamListingCamel,
} from "./adapters";

// Adapters are pure transforms — each test asserts the mapping for one
// load-bearing field per entity. Catches regressions if the underlying
// snake_case column changes without the camelCase consumer being updated.

describe("snake_case → camelCase adapters", () => {
  it("toProfileCamel maps the common fields and splits custom_tags", () => {
    const result = toProfileCamel({
      id: "p1",
      email: "a@b.com",
      phone: null,
      name: "Alice",
      bio: "hi",
      skill_level: "intermediate",
      favorite_surface: "hard",
      profile_image_url: "https://x.png",
      cover_image_url: "",
      cover_offset_y: 50,
      cover_scale: 100,
      custom_tags: "tag1,tag2",
      latitude: 47.6,
      longitude: -122.3,
      gender: "female",
      age_range: "18_29",
      rating_system: "ntrp",
      ntrp_rating: 4.0,
      utr_rating: null,
      handle: "alice",
      venmo_handle: null,
      paypal_handle: null,
      cashapp_handle: null,
      zelle_handle: null,
      onboarding_complete: true,
      is_private: false,
      created_at: "2026-05-21T00:00:00Z",
      updated_at: "2026-05-21T00:00:00Z",
      last_active: "2026-05-21T00:00:00Z",
    });
    expect(result.profileImageUrl).toBe("https://x.png");
    expect(result.skillLevel).toBe("intermediate");
    expect(result.ntrpRating).toBe(4.0);
    expect(result.customTags).toEqual(["tag1", "tag2"]);
    expect(result.email).toBe("a@b.com");
  });

  it("toProfileCamel returns empty array for empty custom_tags", () => {
    const result = toProfileCamel({
      id: "p", email: null, phone: null, name: "", bio: "",
      skill_level: "", favorite_surface: "", profile_image_url: "",
      cover_image_url: "", cover_offset_y: 50, cover_scale: 100,
      custom_tags: "", latitude: null, longitude: null, gender: "",
      age_range: "", rating_system: "", ntrp_rating: null, utr_rating: null,
      handle: null, venmo_handle: null, paypal_handle: null,
      cashapp_handle: null, zelle_handle: null, onboarding_complete: false,
      is_private: false, created_at: "x", updated_at: "x", last_active: "x",
    });
    expect(result.customTags).toEqual([]);
    expect(result.email).toBe("");
  });

  it("toPostCamel flattens author + media", () => {
    const result = toPostCamel({
      id: "post1",
      author_id: "a1",
      content: "rally",
      post_type: "regular", visibility: "friends",
      play_date: "",
      play_time: "",
      play_duration: 90,
      court_location: "", court_facility_id: null,
      game_type: "",
      players_needed: 0,
      players_confirmed: 0,
      skill_min: null,
      skill_max: null,
      court_booked: false,
      is_complete: false,
      comments_disabled: false,
      manual_players: "",
      team_group_id: "",
      is_broadcast: false,
      broadcast_radius_mi: 0,
      broadcast_lat: null,
      broadcast_lng: null,
      event_id: null,
      pinned_at: null,
      created_at: "t",
      author: { id: "a1", name: "Alice", profile_image_url: "x.png" },
      photos: [
        { id: "ph1", url: "u.jpg", order: 0, kind: "image", thumbnail_url: "", duration_ms: null },
      ],
      session_chat: [],
      like_count: 3,
      comment_count: 1,
      is_liked: true,
      my_play_request: null,
      groups: [],
      friend_groups: [],
      audience_label: "",
      event: null,
    });
    expect(result.author.profileImageUrl).toBe("x.png");
    expect(result.likeCount).toBe(3);
    expect(result.isLiked).toBe(true);
    expect(result.media.length).toBe(1);
    expect(result.media[0].kind).toBe("image");
    expect(result.sessionChatId).toBeNull();
  });

  // Mixed-media regression: a single post can now carry both images and
  // videos in a unified ordered list. toPostCamel must sort by `order`,
  // preserve each item's `kind`, and snake→camel the thumbnail / duration
  // fields so PostCard renders the right element per slide.
  it("toPostCamel preserves kind on mixed image+video posts (sorted by order)", () => {
    const result = toPostCamel({
      id: "post-mixed",
      author_id: "a1",
      content: "match highlights",
      post_type: "regular", visibility: "friends",
      play_date: "",
      play_time: "",
      play_duration: 0,
      court_location: "",
      court_facility_id: null,
      game_type: "",
      players_needed: 0,
      players_confirmed: 0,
      skill_min: null,
      skill_max: null,
      court_booked: false,
      is_complete: false,
      comments_disabled: false,
      manual_players: "",
      team_group_id: "",
      is_broadcast: false,
      broadcast_radius_mi: 0,
      broadcast_lat: null,
      broadcast_lng: null,
      event_id: null,
      pinned_at: null,
      created_at: "t",
      author: { id: "a1", name: "Alice", profile_image_url: "" },
      // Out-of-order on purpose — adapter must sort by `order`.
      photos: [
        { id: "v1", url: "clip.mp4", order: 1, kind: "video", thumbnail_url: "poster.jpg", duration_ms: 12500 },
        { id: "p1", url: "shot.jpg", order: 0, kind: "image", thumbnail_url: "", duration_ms: null },
      ],
      session_chat: [],
      like_count: 0,
      comment_count: 0,
      is_liked: false,
      my_play_request: null,
      groups: [],
      friend_groups: [],
      audience_label: "",
      event: null,
    });
    expect(result.media).toEqual([
      { id: "p1", url: "shot.jpg", order: 0, kind: "image", thumbnailUrl: "", durationMs: null },
      { id: "v1", url: "clip.mp4", order: 1, kind: "video", thumbnailUrl: "poster.jpg", durationMs: 12500 },
    ]);
  });

  it("toPostCamel surfaces session_chat[0].id as sessionChatId", () => {
    const result = toPostCamel({
      id: "post-complete",
      author_id: "a1",
      content: "",
      post_type: "find_players", visibility: "friends",
      play_date: "2026-05-23",
      play_time: "09:20",
      play_duration: 90,
      court_location: "Lower Woodland", court_facility_id: null,
      game_type: "singles",
      players_needed: 1,
      players_confirmed: 1,
      skill_min: null,
      skill_max: null,
      court_booked: true,
      is_complete: true,
      comments_disabled: false,
      manual_players: "",
      team_group_id: "",
      is_broadcast: false,
      broadcast_radius_mi: 0,
      broadcast_lat: null,
      broadcast_lng: null,
      event_id: null,
      pinned_at: null,
      created_at: "2026-05-22 03:50:35+00",
      author: { id: "a1", name: "Mimi", profile_image_url: "" },
      photos: [],
      session_chat: [{ id: "chat-123" }],
      like_count: 0,
      comment_count: 0,
      is_liked: false,
      my_play_request: null,
      groups: [],
      friend_groups: [],
      audience_label: "",
      event: null,
    });
    expect(result.sessionChatId).toBe("chat-123");
  });

  // Regression: when PostComposer hands a fresh post off to its onPost
  // callback, callers cast it straight to their camelCase Post type. If the
  // find-player fields aren't renamed, PostCard sees postType=undefined →
  // no badge, no structured card; and the Postgres "+00" offset on
  // created_at trips iOS Safari → "Invalid Date" under the author name.
  // (https://… iPhone screenshot from 2026-05-22.)
  it("toPostCamel maps find-player fields and normalizes created_at", () => {
    const result = toPostCamel({
      id: "post-fp",
      author_id: "a1",
      content: "Looking for 1 player for singles…",
      post_type: "find_players", visibility: "friends",
      play_date: "2026-05-23",
      play_time: "09:20",
      play_duration: 90,
      court_location: "Lower Woodland", court_facility_id: null,
      game_type: "singles",
      players_needed: 1,
      players_confirmed: 0,
      skill_min: 3.5,
      skill_max: 4.0,
      court_booked: false,
      is_complete: false,
      comments_disabled: false,
      manual_players: "",
      team_group_id: "",
      is_broadcast: false,
      broadcast_radius_mi: 0,
      broadcast_lat: null,
      broadcast_lng: null,
      event_id: null,
      pinned_at: null,
      created_at: "2026-05-22 03:50:35.739572+00",
      author: { id: "a1", name: "Mimi Fang", profile_image_url: "" },
      photos: [],
      session_chat: [],
      like_count: 0,
      comment_count: 0,
      is_liked: false,
      my_play_request: null,
      groups: [],
      friend_groups: [],
      audience_label: "",
      event: null,
    });
    expect(result.postType).toBe("find_players");
    expect(result.playDate).toBe("2026-05-23");
    expect(result.playTime).toBe("09:20");
    expect(result.courtLocation).toBe("Lower Woodland");
    expect(result.gameType).toBe("singles");
    expect(result.playersNeeded).toBe(1);
    expect(result.skillMin).toBe(3.5);
    expect(result.skillMax).toBe(4.0);
    // pgToIso must turn the space-separated, bare "+00" form into a value
    // the strict iOS Safari Date parser will accept.
    expect(result.createdAt).toBe("2026-05-22T03:50:35.739572+00:00");
    expect(Number.isNaN(new Date(result.createdAt).getTime())).toBe(false);
  });

  // Regression: PostCard's role gate compares
  // `myRequest.status === "APPROVED"` (uppercase, legacy Prisma enum)
  // but Supabase stores `approved`. toPostCamel must uppercase at the
  // boundary so an approved member (e.g. Chaoran on the "Love hurts"
  // team) renders as a "player" and sees the "Open team" pill on the
  // collapsed propose_team card, not as a "bystander".
  it("toPostCamel uppercases my_play_request.status", () => {
    const result = toPostCamel({
      id: "p-team",
      author_id: "a1",
      content: "",
      post_type: "propose_team", visibility: "friends",
      play_date: "",
      play_time: "",
      play_duration: 0,
      court_location: "Love hurts", court_facility_id: null,
      game_type: "",
      players_needed: 4,
      players_confirmed: 4,
      skill_min: null,
      skill_max: null,
      court_booked: false,
      is_complete: true,
      comments_disabled: false,
      manual_players: "",
      team_group_id: "grp-1",
      is_broadcast: false,
      broadcast_radius_mi: 0,
      broadcast_lat: null,
      broadcast_lng: null,
      event_id: null,
      pinned_at: null,
      created_at: "2026-05-26 06:43:19.824402+00",
      author: { id: "a1", name: "Mimi", profile_image_url: "" },
      photos: [],
      session_chat: [],
      like_count: 0,
      comment_count: 0,
      is_liked: false,
      my_play_request: { id: "req-1", status: "approved", note: "" },
      groups: [],
      friend_groups: [],
      audience_label: "",
      event: null,
    });
    expect(result.myPlayRequest).toEqual({
      id: "req-1",
      status: "APPROVED",
      note: "",
    });
    expect(result.teamGroupId).toBe("grp-1");
  });

  it("toPostCamel passes null my_play_request through unchanged", () => {
    const base = {
      id: "p", author_id: "a1", content: "",
      post_type: "regular" as const, visibility: "friends" as const, play_date: "", play_time: "",
      play_duration: 0, court_location: "", court_facility_id: null, game_type: "",
      players_needed: 0, players_confirmed: 0, skill_min: null, skill_max: null,
      court_booked: false, is_complete: false, comments_disabled: false,
      manual_players: "", team_group_id: "", is_broadcast: false,
      broadcast_radius_mi: 0, broadcast_lat: null, broadcast_lng: null,
      event_id: null, pinned_at: null, created_at: "t",
      author: { id: "a1", name: "", profile_image_url: "" },
      photos: [], session_chat: [],
      like_count: 0, comment_count: 0, is_liked: false,
      my_play_request: null,
      groups: [], friend_groups: [], audience_label: "", event: null,
    };
    expect(toPostCamel(base).myPlayRequest).toBeNull();
  });

  it("toPostCamel maps audience targets (snake -> camel)", () => {
    const base = {
      id: "p", author_id: "a1", content: "",
      post_type: "regular" as const, visibility: "friends" as const, play_date: "", play_time: "",
      play_duration: 0, court_location: "", court_facility_id: null, game_type: "",
      players_needed: 0, players_confirmed: 0, skill_min: null, skill_max: null,
      court_booked: false, is_complete: false, comments_disabled: false,
      manual_players: "", team_group_id: "", is_broadcast: false,
      broadcast_radius_mi: 0, broadcast_lat: null, broadcast_lng: null,
      event_id: null, pinned_at: null, created_at: "t",
      author: { id: "a1", name: "", profile_image_url: "" },
      photos: [], session_chat: [],
      like_count: 0, comment_count: 0, is_liked: false,
      my_play_request: null,
      groups: [{ id: "g1", name: "Wolves" }],
      friend_groups: [{ id: "fg1", name: "Inner Circle" }],
      audience_label: "",
      event: null,
    };
    const result = toPostCamel(base);
    expect(result.groups).toEqual([{ id: "g1", name: "Wolves" }]);
    expect(result.friendGroups).toEqual([{ id: "fg1", name: "Inner Circle" }]);
  });

  it("toCommentCamel flattens author and surfaces parentCommentId + updatedAt", () => {
    const c = toCommentCamel({
      id: "c1",
      post_id: "p1",
      author_id: "a1",
      content: "yo",
      parent_comment_id: null,
      created_at: "t",
      updated_at: null,
      author: { id: "a1", name: "Alice", profile_image_url: "x.png" },
    });
    expect(c.postId).toBe("p1");
    expect(c.author.profileImageUrl).toBe("x.png");
    expect(c.parentCommentId).toBeNull();
    expect(c.updatedAt).toBeNull();

    const edited = toCommentCamel({
      id: "c2",
      post_id: "p1",
      author_id: "a2",
      content: "@Alice yo back",
      parent_comment_id: "c1",
      created_at: "2026-05-23 03:50:35+00",
      updated_at: "2026-05-24 04:11:00+00",
      author: { id: "a2", name: "Bob", profile_image_url: "" },
    });
    expect(edited.parentCommentId).toBe("c1");
    expect(edited.updatedAt).toBe("2026-05-24T04:11:00+00:00");
  });

  it("toEventCamel + toGroupCamel + toTeamListingCamel basic shape", () => {
    const ev = toEventCamel({
      id: "e", owner_id: "o", title: "T",
      description: "", event_type: "mixer",
      start_date: "2026-06-01", end_date: "2026-06-02",
      signup_deadline: null, is_public_signup: true,
      max_participants: null, ntrp_min: null, ntrp_max: null,
      status: "open", venue_name: "", venue_address: "",
      visibility: "public", event_lat: 47.6, event_lng: -122.3,
      radius_mi: 25, host_group_id: null, config: {},
      cover_image_url: "", season_id: null,
      created_at: "t", updated_at: "t",
    });
    expect(ev.startDate).toBe("2026-06-01");
    expect(ev.eventType).toBe("mixer");
    expect(ev.visibility).toBe("public");

    const g = toGroupCamel({
      id: "g", name: "Team", image_url: "i.png",
      cover_image_url: "", cover_offset_y: 50, cover_scale: 100,
      owner_id: "o", member_types: [], reminder_prefs: {},
      created_at: "t", updated_at: "t",
    });
    expect(g.imageUrl).toBe("i.png");
    expect(g.ownerId).toBe("o");

    const l = toTeamListingCamel({
      id: "l", group_id: "g", created_by_id: "u",
      title: "Need 4th", description: "", format: "doubles",
      ntrp_min: null, ntrp_max: null, city: "",
      status: "open", expires_at: null, created_at: "t", updated_at: "t",
      group: { id: "g", name: "Team", image_url: "i.png" },
    });
    expect(l.format).toBe("doubles");
    expect(l.group.imageUrl).toBe("i.png");
  });

  it("toGroupMessageCamel + toNotificationCamel + toDirectMessageCamel + toChatMessageCamel preserve sender info", () => {
    const gm = toGroupMessageCamel({
      id: "gm", group_id: "g", sender_id: "s", content: "go",
      media_url: "", media_type: "", shared_post_id: null,
      kind: "chat", notify_email: false, pinned_at: null,
      poll_id: null, created_at: "t",
      sender: { id: "s", name: "Sender", profile_image_url: "x.png" },
    });
    expect(gm.sender.profileImageUrl).toBe("x.png");
    expect(gm.kind).toBe("chat");

    const n = toNotificationCamel({
      id: "n", user_id: "u", actor_id: "a", actor_guest_name: null, type: "like",
      post_id: null, comment_id: null, message_id: null,
      chat_message_id: null, group_message_id: null,
      event_id: null, match_id: null, poll_id: null, friend_group_id: null,
      court_id: null,
      emoji: "", read: false,
      created_at: "t",
      actor: { id: "a", name: "Actor", profile_image_url: "x.png" },
      chat_message: null, group_message: null,
    });
    expect(n.postId).toBe("");
    expect(n.actor.profileImageUrl).toBe("x.png");

    // message_reaction in a session chat resolves the thread id for routing.
    const nChat = toNotificationCamel({
      id: "n2", user_id: "u", actor_id: "a", actor_guest_name: null, type: "message_reaction",
      post_id: null, comment_id: null, message_id: null,
      chat_message_id: "cm1", group_message_id: null,
      event_id: null, match_id: null, poll_id: null, friend_group_id: null,
      court_id: null,
      emoji: "love", read: false,
      created_at: "t",
      actor: { id: "a", name: "Actor", profile_image_url: "x.png" },
      chat_message: { chat_id: "chat-9" }, group_message: null,
    });
    expect(nChat.chatId).toBe("chat-9");
    expect(nChat.groupId).toBe("");

    // A guest (accountless) actor has no profile join — the adapter
    // synthesizes a display actor from actor_guest_name, empty id/avatar.
    const nGuest = toNotificationCamel({
      id: "n3", user_id: "u", actor_id: null, actor_guest_name: "Casey Guest",
      type: "join_request",
      post_id: "p1", comment_id: null, message_id: null,
      chat_message_id: null, group_message_id: null,
      event_id: null, match_id: null, poll_id: null, friend_group_id: null,
      court_id: null,
      emoji: "", read: false,
      created_at: "t",
      actor: null,
      chat_message: null, group_message: null,
    });
    expect(nGuest.actorId).toBe("");
    expect(nGuest.actor.id).toBe("");
    expect(nGuest.actor.name).toBe("Casey Guest");
    expect(nGuest.actor.profileImageUrl).toBe("");

    const dm = toDirectMessageCamel({
      id: "dm", sender_id: "s", receiver_id: "r", content: "hi",
      media_url: "", media_type: "", shared_post_id: null, created_at: "t",
    });
    expect(dm.senderId).toBe("s");

    const cm = toChatMessageCamel({
      id: "cm", chat_id: "c", sender_id: "s", content: "hey",
      media_url: "", media_type: "", shared_post_id: "p1", created_at: "t",
      expense_id: "exp1",
      sender: { id: "s", name: "Sender", profile_image_url: "x.png" },
    });
    expect(cm.chatId).toBe("c");
    expect(cm.sharedPostId).toBe("p1");
    expect(cm.sender.profileImageUrl).toBe("x.png");
    // Expense announcements carry the FK through for the tap-to-pay chip.
    expect(cm.expenseId).toBe("exp1");

    const plainCm = toChatMessageCamel({
      id: "cm2", chat_id: "c", sender_id: "s", content: "hey",
      media_url: "", media_type: "", shared_post_id: null, created_at: "t",
      expense_id: null,
      sender: { id: "s", name: "Sender", profile_image_url: "" },
    });
    expect(plainCm.expenseId).toBeNull();
  });

  // Regression: all chat surfaces feed createdAt into new Date(...) for
  // timeAgo / date separators / sort comparators. The chat pages used to
  // pass m.created_at through unchanged, and iOS Safari's strict parser
  // NaN'd the Postgres "+00" form → "Invalid Date" everywhere. Each
  // message adapter must normalize via pgToIso so the chat pages can
  // build their Message off the adapter and inherit the fix.
  it("message adapters normalize createdAt for iOS Safari", () => {
    const pgStamp = "2026-05-22 03:50:35.739572+00";
    const expected = "2026-05-22T03:50:35.739572+00:00";

    const gm = toGroupMessageCamel({
      id: "gm", group_id: "g", sender_id: "s", content: "go",
      media_url: "", media_type: "", shared_post_id: null,
      kind: "chat", notify_email: false, pinned_at: pgStamp,
      poll_id: null, created_at: pgStamp,
      sender: { id: "s", name: "Sender", profile_image_url: "" },
    });
    expect(gm.createdAt).toBe(expected);
    expect(gm.pinnedAt).toBe(expected);

    const dm = toDirectMessageCamel({
      id: "dm", sender_id: "s", receiver_id: "r", content: "hi",
      media_url: "", media_type: "", shared_post_id: null,
      created_at: pgStamp,
    });
    expect(dm.createdAt).toBe(expected);

    const cm = toChatMessageCamel({
      id: "cm", chat_id: "c", sender_id: "s", content: "hey",
      media_url: "", media_type: "", shared_post_id: null, created_at: pgStamp,
      expense_id: null,
      sender: { id: "s", name: "Sender", profile_image_url: "" },
    });
    expect(cm.createdAt).toBe(expected);

    // Final iOS-Safari smoke check: every normalized stamp survives the
    // strict Date parser (no NaN) — the actual user-facing failure mode.
    for (const v of [gm.createdAt, gm.pinnedAt!, dm.createdAt, cm.createdAt]) {
      expect(Number.isNaN(new Date(v).getTime())).toBe(false);
    }
  });
});
