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
      is_private: false, created_at: "x", updated_at: "x",
    });
    expect(result.customTags).toEqual([]);
    expect(result.email).toBe("");
  });

  it("toPostCamel flattens author + photos", () => {
    const result = toPostCamel({
      id: "post1",
      author_id: "a1",
      content: "rally",
      media_url: "",
      media_type: "",
      post_type: "regular",
      play_date: "",
      play_time: "",
      play_duration: 90,
      court_location: "",
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
      photos: [{ id: "ph1", url: "u.jpg", order: 0 }],
      session_chat: [],
      like_count: 3,
      comment_count: 1,
      is_liked: true,
    });
    expect(result.author.profileImageUrl).toBe("x.png");
    expect(result.likeCount).toBe(3);
    expect(result.isLiked).toBe(true);
    expect(result.photos.length).toBe(1);
    expect(result.sessionChatId).toBeNull();
  });

  it("toPostCamel surfaces session_chat[0].id as sessionChatId", () => {
    const result = toPostCamel({
      id: "post-complete",
      author_id: "a1",
      content: "",
      media_url: "",
      media_type: "",
      post_type: "find_players",
      play_date: "2026-05-23",
      play_time: "09:20",
      play_duration: 90,
      court_location: "Lower Woodland",
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
      media_url: "",
      media_type: "",
      post_type: "find_players",
      play_date: "2026-05-23",
      play_time: "09:20",
      play_duration: 90,
      court_location: "Lower Woodland",
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

  it("toCommentCamel flattens author and surfaces parentCommentId", () => {
    const c = toCommentCamel({
      id: "c1",
      post_id: "p1",
      author_id: "a1",
      content: "yo",
      parent_comment_id: null,
      created_at: "t",
      author: { id: "a1", name: "Alice", profile_image_url: "x.png" },
    });
    expect(c.postId).toBe("p1");
    expect(c.author.profileImageUrl).toBe("x.png");
    expect(c.parentCommentId).toBeNull();

    const reply = toCommentCamel({
      id: "c2",
      post_id: "p1",
      author_id: "a2",
      content: "@Alice yo back",
      parent_comment_id: "c1",
      created_at: "t",
      author: { id: "a2", name: "Bob", profile_image_url: "" },
    });
    expect(reply.parentCommentId).toBe("c1");
  });

  it("toEventCamel + toGroupCamel + toTeamListingCamel basic shape", () => {
    const ev = toEventCamel({
      id: "e", owner_id: "o", group_id: null, title: "T",
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
      id: "n", user_id: "u", actor_id: "a", type: "like",
      post_id: null, comment_id: null, message_id: null,
      event_id: null, match_id: null, emoji: "", read: false,
      created_at: "t",
      actor: { id: "a", name: "Actor", profile_image_url: "x.png" },
    });
    expect(n.postId).toBe("");
    expect(n.actor.profileImageUrl).toBe("x.png");

    const dm = toDirectMessageCamel({
      id: "dm", sender_id: "s", receiver_id: "r", content: "hi",
      media_url: "", media_type: "", shared_post_id: null, created_at: "t",
    });
    expect(dm.senderId).toBe("s");

    const cm = toChatMessageCamel({
      id: "cm", chat_id: "c", sender_id: "s", content: "hey",
      media_url: "", media_type: "", created_at: "t",
      sender: { id: "s", name: "Sender", profile_image_url: "x.png" },
    });
    expect(cm.chatId).toBe("c");
    expect(cm.sender.profileImageUrl).toBe("x.png");
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
      media_url: "", media_type: "", created_at: pgStamp,
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
