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
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

// ---------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------

export interface PostCamel {
  id: string;
  authorId: string;
  content: string;
  mediaUrl: string;
  mediaType: string;
  postType: "regular" | "find_players" | "propose_team" | "event";
  playDate: string;
  playTime: string;
  playDuration: number;
  courtLocation: string;
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
  photos: { id: string; url: string; order: number }[];
  likeCount: number;
  commentCount: number;
  isLiked: boolean;
}

export function toPostCamel(p: Post): PostCamel {
  return {
    id: p.id,
    authorId: p.author_id,
    content: p.content,
    mediaUrl: p.media_url,
    mediaType: p.media_type,
    postType: p.post_type,
    playDate: p.play_date,
    playTime: p.play_time,
    playDuration: p.play_duration,
    courtLocation: p.court_location,
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
    pinnedAt: p.pinned_at,
    createdAt: p.created_at,
    author: {
      id: p.author.id,
      name: p.author.name,
      profileImageUrl: p.author.profile_image_url,
    },
    photos: p.photos,
    likeCount: p.like_count,
    commentCount: p.comment_count,
    isLiked: p.is_liked,
  };
}

export interface CommentCamel {
  id: string;
  postId: string;
  authorId: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string; profileImageUrl: string };
}

export function toCommentCamel(c: Comment): CommentCamel {
  return {
    id: c.id,
    postId: c.post_id,
    authorId: c.author_id,
    content: c.content,
    createdAt: c.created_at,
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
  groupId: string | null;
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
    groupId: e.group_id,
    title: e.title,
    description: e.description,
    eventType: e.event_type,
    startDate: e.start_date,
    endDate: e.end_date,
    signupDeadline: e.signup_deadline,
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
    registeredAt: p.registered_at,
    checkedInAt: p.checked_in_at,
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
    scheduledAt: m.scheduled_at,
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
  role: string;
  memberType: string;
  user: { id: string; name: string; profileImageUrl: string; ntrpRating: number | null };
}

export function toGroupMemberCamel(m: GroupMember): GroupMemberCamel {
  return {
    id: m.id,
    groupId: m.group_id,
    userId: m.user_id,
    role: m.role,
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
    pinnedAt: m.pinned_at,
    pollId: m.poll_id,
    createdAt: m.created_at,
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
    emoji: n.emoji,
    read: n.read,
    createdAt: n.created_at,
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
    createdAt: m.created_at,
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
    createdAt: m.created_at,
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
    expiresAt: l.expires_at,
    createdAt: l.created_at,
    group: {
      id: l.group?.id ?? l.group_id,
      name: l.group?.name ?? "",
      imageUrl: l.group?.image_url ?? "",
    },
  };
}
