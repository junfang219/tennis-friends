// Shared snake_case → camelCase adapters.
//
// The Supabase JS client returns snake_case rows matching Postgres column
// names; most existing page state predates the migration and is camelCase.
// Rather than littering every page with inline transforms, every entity
// gets one named adapter here. Pages call e.g. `toProfileCamel(row)` and
// get back the legacy shape ready to drop into setState.
//
// This is a transitional surface. As pages adopt snake_case natively
// (typically via a follow-up cleanup pass) the corresponding adapter
// can be deleted.

import type { Profile } from "./queries/profiles";
import type { Post, Comment } from "./queries/posts";
import type {
  EventRow,
  EventParticipantRow,
  EventMatchRow,
} from "./queries/events";
import type { GroupMessage, Group, GroupMember } from "./queries/groups";
import type { Notification } from "./queries/notifications";
import type { DirectMessage } from "./queries/messages";
import type { ChatMessage } from "./queries/chats";
import type { TeamListing } from "./queries/misc";
import { pgToIso } from "../pgDate";

// Every adapter normalizes timestamptz fields through pgToIso so iOS
// Safari's strict Date parser doesn't return NaN ("Invalid Date") on
// values served with the Postgres "YYYY-MM-DD HH:mm:ss+00" format.

// ---------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------

export interface ProfileCamel {
  id: string;
  email: string;
  phone: string | null;
  name: string;
  bio: string;
  skillLevel: string;
  favoriteSurface: string;
  profileImageUrl: string;
  coverImageUrl: string;
  coverOffsetY: number;
  coverScale: number;
  customTags: string[];
  latitude: number | null;
  longitude: number | null;
  gender: string;
  ageRange: string;
  ratingSystem: string;
  ntrpRating: number | null;
  utrRating: number | null;
  handle: string | null;
  venmoHandle: string;
  paypalHandle: string;
  cashappHandle: string;
  zelleHandle: string;
  onboardingComplete: boolean;
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
  lastActive: string;
}

export function toProfileCamel(p: Profile): ProfileCamel {
  return {
    id: p.id,
    email: p.email ?? "",
    phone: p.phone,
    name: p.name,
    bio: p.bio,
    skillLevel: p.skill_level,
    favoriteSurface: p.favorite_surface,
    profileImageUrl: p.profile_image_url,
    coverImageUrl: p.cover_image_url,
    coverOffsetY: p.cover_offset_y,
    coverScale: p.cover_scale,
    customTags: p.custom_tags ? p.custom_tags.split(",").filter(Boolean) : [],
    latitude: p.latitude,
    longitude: p.longitude,
    gender: p.gender,
    ageRange: p.age_range,
    ratingSystem: p.rating_system,
    ntrpRating: p.ntrp_rating,
    utrRating: p.utr_rating,
    handle: p.handle,
    venmoHandle: p.venmo_handle ?? "",
    paypalHandle: p.paypal_handle ?? "",
    cashappHandle: p.cashapp_handle ?? "",
    zelleHandle: p.zelle_handle ?? "",
    onboardingComplete: p.onboarding_complete,
    isPrivate: p.is_private,
    createdAt: pgToIso(p.created_at),
    updatedAt: pgToIso(p.updated_at),
    lastActive: pgToIso(p.last_active),
  };
}

// ---------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------

// Camel-cased post media item — what PostCard and SharedPostCard render
// out of the unified ordered list. Mirrors PostMediaRow with thumbnailUrl
// / durationMs.
export interface PostMediaCamel {
  id: string;
  url: string;
  order: number;
  kind: "image" | "video";
  thumbnailUrl: string;
  durationMs: number | null;
}

export interface PostCamel {
  id: string;
  authorId: string;
  content: string;
  postType: "regular" | "find_players" | "propose_team" | "event" | "note";
  // 'friends' (default) follows can_see_post's friends/targets rules.
  // 'private' is author-only and is what Playbook entries default to.
  // PlaybookEntryCard reads this to render the 🔒 / 👥 badge.
  visibility: "friends" | "private";
  playDate: string;
  playTime: string;
  playDuration: number;
  courtLocation: string;
  // Catalog id ("tf-N" matching Facility.courtId) when the author either
  // picked a court from the composer typeahead or their free text
  // resolved to a known facility. PostCard renders courtLocation as a
  // /courts?selected=tf-N deep link when this is set, plain text when null.
  courtFacilityId: string | null;
  gameType: string;
  playersNeeded: number;
  playersConfirmed: number;
  skillMin: number | null;
  skillMax: number | null;
  courtBooked: boolean;
  isComplete: boolean;
  commentsDisabled: boolean;
  isBroadcast: boolean;
  broadcastRadiusMi: number;
  broadcastLat: number | null;
  broadcastLng: number | null;
  eventId: string | null;
  pinnedAt: string | null;
  createdAt: string;
  author: { id: string; name: string; profileImageUrl: string };
  // Ordered post media (images + videos interleaved). PostCard renders
  // <img> or <video> per item based on kind. Empty for text-only posts.
  media: PostMediaCamel[];
  likeCount: number;
  commentCount: number;
  isLiked: boolean;
  // The auto-created session group chat for a completed find_players
  // post (null until the post fills and the trigger fires). PostCard
  // reads this to render the "Open chat" CTA on the collapsed card.
  sessionChatId: string | null;
  // The auto-created team Group for a completed propose_team post
  // (null until the post fills and the create_team_group_on_complete
  // trigger fires). Stored as text in the DB with default '' — we
  // collapse the empty default to null here so PostCard's
  // `liveTeamGroupId || null` checks behave correctly.
  teamGroupId: string | null;
  // The signed-in user's own play_request against this post, if any.
  // Status is uppercased here so the legacy PostCard checks
  // (status === "APPROVED" / "PENDING" / …) keep working; Supabase
  // stores the enum in lowercase. Null for the author + when no
  // request exists.
  myPlayRequest: { id: string; status: string; note: string } | null;
  // Audience targets resolved from post_targets. Empty arrays = default
  // friends-visibility. PostCard reads these for the audience badge and to
  // pre-select groups when editing.
  groups: { id: string; name: string }[];
  friendGroups: { id: string; name: string }[];
}

export function toPostCamel(p: Post): PostCamel {
  return {
    id: p.id,
    authorId: p.author_id,
    content: p.content,
    postType: p.post_type,
    visibility: p.visibility,
    playDate: p.play_date,
    playTime: p.play_time,
    playDuration: p.play_duration,
    courtLocation: p.court_location,
    courtFacilityId: p.court_facility_id,
    gameType: p.game_type,
    playersNeeded: p.players_needed,
    playersConfirmed: p.players_confirmed,
    skillMin: p.skill_min,
    skillMax: p.skill_max,
    courtBooked: p.court_booked,
    isComplete: p.is_complete,
    commentsDisabled: p.comments_disabled,
    isBroadcast: p.is_broadcast,
    broadcastRadiusMi: p.broadcast_radius_mi,
    broadcastLat: p.broadcast_lat,
    broadcastLng: p.broadcast_lng,
    eventId: p.event_id,
    pinnedAt: p.pinned_at ? pgToIso(p.pinned_at) : null,
    createdAt: pgToIso(p.created_at),
    author: {
      id: p.author.id,
      name: p.author.name,
      profileImageUrl: p.author.profile_image_url,
    },
    media: [...p.photos]
      .sort((a, b) => a.order - b.order)
      .map((m) => ({
        id: m.id,
        url: m.url,
        order: m.order,
        kind: m.kind,
        thumbnailUrl: m.thumbnail_url,
        durationMs: m.duration_ms,
      })),
    likeCount: p.like_count,
    commentCount: p.comment_count,
    isLiked: p.is_liked,
    sessionChatId: p.session_chat?.[0]?.id ?? null,
    teamGroupId: p.team_group_id ? p.team_group_id : null,
    myPlayRequest: p.my_play_request
      ? {
          id: p.my_play_request.id,
          status: p.my_play_request.status.toUpperCase(),
          note: p.my_play_request.note,
        }
      : null,
    groups: p.groups,
    friendGroups: p.friend_groups,
  };
}

export interface CommentCamel {
  id: string;
  postId: string;
  authorId: string;
  content: string;
  parentCommentId: string | null;
  createdAt: string;
  // NULL until an edit lands. UI shows "(edited)" when populated.
  updatedAt: string | null;
  author: { id: string; name: string; profileImageUrl: string };
}

export function toCommentCamel(c: Comment): CommentCamel {
  return {
    id: c.id,
    postId: c.post_id,
    authorId: c.author_id,
    content: c.content,
    parentCommentId: c.parent_comment_id,
    createdAt: pgToIso(c.created_at),
    updatedAt: c.updated_at ? pgToIso(c.updated_at) : null,
    author: {
      id: c.author.id,
      name: c.author.name,
      profileImageUrl: c.author.profile_image_url,
    },
  };
}

// ---------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------

export interface EventCamel {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  eventType: string;
  startDate: string;
  endDate: string;
  signupDeadline: string | null;
  isPublicSignup: boolean;
  maxParticipants: number | null;
  ntrpMin: number | null;
  ntrpMax: number | null;
  status: string;
  venueName: string;
  venueAddress: string;
  visibility: "public" | "group";
  eventLat: number | null;
  eventLng: number | null;
  radiusMi: number | null;
  hostGroupId: string | null;
  coverImageUrl: string;
  seasonId: string | null;
}

export function toEventCamel(e: EventRow): EventCamel {
  return {
    id: e.id,
    ownerId: e.owner_id,
    title: e.title,
    description: e.description,
    eventType: e.event_type,
    startDate: pgToIso(e.start_date),
    endDate: pgToIso(e.end_date),
    signupDeadline: e.signup_deadline ? pgToIso(e.signup_deadline) : null,
    isPublicSignup: e.is_public_signup,
    maxParticipants: e.max_participants,
    ntrpMin: e.ntrp_min,
    ntrpMax: e.ntrp_max,
    status: e.status,
    venueName: e.venue_name,
    venueAddress: e.venue_address,
    visibility: e.visibility,
    eventLat: e.event_lat,
    eventLng: e.event_lng,
    radiusMi: e.radius_mi,
    hostGroupId: e.host_group_id,
    coverImageUrl: e.cover_image_url,
    seasonId: e.season_id,
  };
}

export interface EventParticipantCamel {
  id: string;
  eventId: string;
  userId: string;
  status: "registered" | "waitlist" | "withdrawn";
  registeredAt: string;
  checkedInAt: string | null;
  wins: number;
  losses: number;
  setsWon: number;
  setsLost: number;
  points: number;
  user: { id: string; name: string; profileImageUrl: string; ntrpRating: number | null };
}

export function toEventParticipantCamel(p: EventParticipantRow): EventParticipantCamel {
  return {
    id: p.id,
    eventId: p.event_id,
    userId: p.user_id,
    status: p.status,
    registeredAt: pgToIso(p.registered_at),
    checkedInAt: p.checked_in_at ? pgToIso(p.checked_in_at) : null,
    wins: p.wins,
    losses: p.losses,
    setsWon: p.sets_won,
    setsLost: p.sets_lost,
    points: p.points,
    user: {
      id: p.user.id,
      name: p.user.name,
      profileImageUrl: p.user.profile_image_url,
      ntrpRating: p.user.ntrp_rating,
    },
  };
}

export interface EventMatchCamel {
  id: string;
  eventId: string;
  player1Id: string;
  player2Id: string;
  player3Id: string | null;
  player4Id: string | null;
  round: number | null;
  bracketSlot: string;
  scheduledAt: string | null;
  courtAssign: string;
  score: string;
  winnerSide: number | null;
  status: string;
}

export function toEventMatchCamel(m: EventMatchRow): EventMatchCamel {
  return {
    id: m.id,
    eventId: m.event_id,
    player1Id: m.player1_id,
    player2Id: m.player2_id,
    player3Id: m.player3_id,
    player4Id: m.player4_id,
    round: m.round,
    bracketSlot: m.bracket_slot,
    scheduledAt: m.scheduled_at ? pgToIso(m.scheduled_at) : null,
    courtAssign: m.court_assign,
    score: m.score,
    winnerSide: m.winner_side,
    status: m.status,
  };
}

// ---------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------

export interface GroupCamel {
  id: string;
  name: string;
  imageUrl: string;
  coverImageUrl: string;
  ownerId: string;
}

export function toGroupCamel(g: Group): GroupCamel {
  return {
    id: g.id,
    name: g.name,
    imageUrl: g.image_url,
    coverImageUrl: g.cover_image_url,
    ownerId: g.owner_id,
  };
}

export interface GroupMemberCamel {
  id: string;
  groupId: string;
  userId: string;
  roles: ("manager" | "captain")[];
  memberType: string;
  user: { id: string; name: string; profileImageUrl: string; ntrpRating: number | null };
}

export function toGroupMemberCamel(m: GroupMember): GroupMemberCamel {
  return {
    id: m.id,
    groupId: m.group_id,
    userId: m.user_id,
    roles: m.roles,
    memberType: m.member_type,
    user: {
      id: m.user.id,
      name: m.user.name,
      profileImageUrl: m.user.profile_image_url,
      ntrpRating: m.user.ntrp_rating,
    },
  };
}

export interface GroupMessageCamel {
  id: string;
  groupId: string;
  senderId: string;
  content: string;
  mediaUrl: string;
  mediaType: string;
  sharedPostId: string | null;
  kind: "chat" | "announcement";
  notifyEmail: boolean;
  pinnedAt: string | null;
  pollId: string | null;
  createdAt: string;
  sender: { id: string; name: string; profileImageUrl: string };
}

export function toGroupMessageCamel(m: GroupMessage): GroupMessageCamel {
  return {
    id: m.id,
    groupId: m.group_id,
    senderId: m.sender_id,
    content: m.content,
    mediaUrl: m.media_url,
    mediaType: m.media_type,
    sharedPostId: m.shared_post_id,
    kind: m.kind,
    notifyEmail: m.notify_email,
    pinnedAt: m.pinned_at ? pgToIso(m.pinned_at) : null,
    pollId: m.poll_id,
    createdAt: pgToIso(m.created_at),
    sender: {
      id: m.sender.id,
      name: m.sender.name,
      profileImageUrl: m.sender.profile_image_url,
    },
  };
}

// ---------------------------------------------------------------------
// Notifications, DMs, chat messages
// ---------------------------------------------------------------------

export interface NotificationCamel {
  id: string;
  userId: string;
  actorId: string;
  type: string;
  postId: string;
  commentId: string;
  messageId: string;
  eventId: string;
  matchId: string;
  pollId: string;
  emoji: string;
  read: boolean;
  createdAt: string;
  actor: { id: string; name: string; profileImageUrl: string };
}

export function toNotificationCamel(n: Notification): NotificationCamel {
  return {
    id: n.id,
    userId: n.user_id,
    actorId: n.actor_id,
    type: n.type,
    postId: n.post_id ?? "",
    commentId: n.comment_id ?? "",
    messageId: n.message_id ?? "",
    eventId: n.event_id ?? "",
    matchId: n.match_id ?? "",
    pollId: n.poll_id ?? "",
    emoji: n.emoji,
    read: n.read,
    createdAt: pgToIso(n.created_at),
    actor: {
      id: n.actor.id,
      name: n.actor.name,
      profileImageUrl: n.actor.profile_image_url,
    },
  };
}

export interface DirectMessageCamel {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  mediaUrl: string;
  mediaType: string;
  sharedPostId: string | null;
  createdAt: string;
}

export function toDirectMessageCamel(m: DirectMessage): DirectMessageCamel {
  return {
    id: m.id,
    senderId: m.sender_id,
    receiverId: m.receiver_id,
    content: m.content,
    mediaUrl: m.media_url,
    mediaType: m.media_type,
    sharedPostId: m.shared_post_id,
    createdAt: pgToIso(m.created_at),
  };
}

export interface ChatMessageCamel {
  id: string;
  chatId: string;
  senderId: string;
  content: string;
  mediaUrl: string;
  mediaType: string;
  createdAt: string;
  sender: { id: string; name: string; profileImageUrl: string };
}

export function toChatMessageCamel(m: ChatMessage): ChatMessageCamel {
  return {
    id: m.id,
    chatId: m.chat_id,
    senderId: m.sender_id,
    content: m.content,
    mediaUrl: m.media_url,
    mediaType: m.media_type,
    createdAt: pgToIso(m.created_at),
    sender: {
      id: m.sender.id,
      name: m.sender.name,
      profileImageUrl: m.sender.profile_image_url,
    },
  };
}

// ---------------------------------------------------------------------
// Team listings (MatchUp)
// ---------------------------------------------------------------------

export interface TeamListingCamel {
  id: string;
  groupId: string;
  createdById: string;
  title: string;
  description: string;
  format: string;
  ntrpMin: number | null;
  ntrpMax: number | null;
  city: string;
  status: string;
  expiresAt: string | null;
  createdAt: string;
  group: { id: string; name: string; imageUrl: string };
}

export function toTeamListingCamel(l: TeamListing): TeamListingCamel {
  return {
    id: l.id,
    groupId: l.group_id,
    createdById: l.created_by_id,
    title: l.title,
    description: l.description,
    format: l.format,
    ntrpMin: l.ntrp_min,
    ntrpMax: l.ntrp_max,
    city: l.city,
    status: l.status,
    expiresAt: l.expires_at ? pgToIso(l.expires_at) : null,
    createdAt: pgToIso(l.created_at),
    group: {
      id: l.group?.id ?? l.group_id,
      name: l.group?.name ?? "",
      imageUrl: l.group?.image_url ?? "",
    },
  };
}
