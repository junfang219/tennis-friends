import { pgToIso } from "@/lib/pgDate";
import type { Post as FeedPost } from "@/lib/supabase/queries";

// The legacy camelCase Post shape that PostCard (and the pages that feed it)
// expect. Both the home feed and the group/team feed adapt their snake_case
// Supabase rows into this shape via adaptFeedPost(), so they render
// identically. Will go away once PostCard consumes the snake_case row natively.
export type FeedPostView = {
  id: string;
  content: string;
  mediaUrl?: string;
  mediaType?: string;
  postType?: string;
  playDate?: string;
  playTime?: string;
  courtLocation?: string;
  gameType?: string;
  playersNeeded?: number;
  playersConfirmed?: number;
  courtBooked?: boolean;
  isComplete?: boolean;
  photoUrls?: string[];
  isBroadcast?: boolean;
  broadcastRadiusMi?: number;
  distanceMiles?: number | null;
  pendingRequestCount?: number;
  myPlayRequest?: { id: string; status: string; note: string } | null;
  sessionChatId?: string | null;
  teamGroupId?: string | null;
  manualPlayers?: string;
  createdAt: string;
  author: { id: string; name: string; profileImageUrl: string };
  likeCount: number;
  commentCount?: number;
  isLiked: boolean;
  groups?: { id: string; name: string }[];
  friendGroups?: { id: string; name: string }[];
  // Populated for posts cross-posted from a new event (post_type='event'
  // with event_id set). PostCard's EventChip uses this so the card
  // renders date / venue / type / signups without a follow-up fetch.
  event?: {
    id: string;
    title: string;
    eventType: string;
    startDate: string;
    endDate: string;
    venueName: string;
    venueAddress: string;
    maxParticipants: number | null;
    ntrpMin: number | null;
    ntrpMax: number | null;
    coverImageUrl: string;
    registeredCount: number;
  } | null;
};

// Map a Supabase feed row (snake_case) into the legacy camelCase Post shape
// PostCard currently expects.
export function adaptFeedPost(p: FeedPost): FeedPostView {
  return {
    id: p.id,
    content: p.content,
    mediaUrl: p.media_url,
    mediaType: p.media_type,
    // Flatten the joined photos rows into PostCard's photoUrls list.
    // Sorted by the explicit display order so the multi-photo viewer
    // stays consistent with how PostComposer inserted them.
    photoUrls: [...p.photos].sort((a, b) => a.order - b.order).map((ph) => ph.url),
    postType: p.post_type,
    playDate: p.play_date,
    playTime: p.play_time,
    courtLocation: p.court_location,
    gameType: p.game_type,
    playersNeeded: p.players_needed,
    playersConfirmed: p.players_confirmed,
    courtBooked: p.court_booked,
    isComplete: p.is_complete,
    isBroadcast: p.is_broadcast,
    broadcastRadiusMi: p.broadcast_radius_mi,
    distanceMiles: null,
    pendingRequestCount: 0,
    // Uppercase the Supabase lowercase enum so PostCard's legacy
    // `status === "APPROVED"` checks resolve to "player" instead of
    // "bystander" for approved members. enrichPosts already restricted
    // the join to the signed-in user, so this row is theirs.
    myPlayRequest: p.my_play_request
      ? {
          id: p.my_play_request.id,
          status: p.my_play_request.status.toUpperCase(),
          note: p.my_play_request.note,
        }
      : null,
    sessionChatId: p.session_chat?.[0]?.id ?? null,
    // Empty default from posts.team_group_id collapses to null so
    // PostCard's `liveTeamGroupId || null` checks render the collapsed
    // "Open team" CTA whenever the create_team_group_on_complete trigger
    // has populated the column.
    teamGroupId: p.team_group_id ? p.team_group_id : null,
    manualPlayers: p.manual_players,
    // PostgREST emits "2026-05-21 18:23:35.123+00"; iOS Safari's strict
    // Date parser rejects the space + bare-offset form. Normalize once
    // here so every consumer (timeAgo, toLocaleDateString) sees ISO.
    createdAt: pgToIso(p.created_at),
    author: {
      id: p.author.id,
      name: p.author.name,
      profileImageUrl: p.author.profile_image_url,
    },
    likeCount: p.like_count,
    commentCount: p.comment_count,
    isLiked: p.is_liked,
    // Audience targets, so PostCard renders the right badge and — critically —
    // the edit modal pre-selects the actual groups instead of wiping them.
    groups: p.groups,
    friendGroups: p.friend_groups,
    event: p.event
      ? {
          id: p.event.id,
          title: p.event.title,
          eventType: p.event.event_type,
          startDate: pgToIso(p.event.start_date),
          endDate: pgToIso(p.event.end_date),
          venueName: p.event.venue_name,
          venueAddress: p.event.venue_address,
          maxParticipants: p.event.max_participants,
          ntrpMin: p.event.ntrp_min,
          ntrpMax: p.event.ntrp_max,
          coverImageUrl: p.event.cover_image_url,
          registeredCount: p.event.registered_count,
        }
      : null,
  };
}
