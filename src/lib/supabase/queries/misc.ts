"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";

// Catch-all for query helpers covering smaller domains: team listings,
// group invites, dashboard aggregation, reactions, friend groups,
// highlights, device tokens, hidden posts, play requests.

// ---------------------------------------------------------------------
// Team listings (MatchUp bulletin)
// ---------------------------------------------------------------------

export interface TeamListing {
  id: string;
  group_id: string;
  created_by_id: string;
  title: string;
  description: string;
  format: "singles" | "doubles" | "mixed_doubles" | "any";
  ntrp_min: number | null;
  ntrp_max: number | null;
  city: string;
  status: "open" | "filled" | "closed";
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  group?: { id: string; name: string; image_url: string };
}

export async function listTeamListings(
  supabase: SupabaseClient<Database>,
  opts: { format?: string; city?: string; limit?: number } = {}
): Promise<TeamListing[]> {
  let q = supabase
    .from("team_listings")
    .select(
      `id, group_id, created_by_id, title, description, format, ntrp_min, ntrp_max, city, status, expires_at, created_at, updated_at,
       group:groups!team_listings_group_id_fkey ( id, name, image_url )`
    )
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.format && opts.format !== "any") q = q.eq("format", opts.format as TeamListing["format"]);
  if (opts.city) q = q.ilike("city", `%${opts.city}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as TeamListing[];
}

export async function createTeamListing(
  supabase: SupabaseClient<Database>,
  groupId: string,
  input: Omit<TeamListing, "id" | "group_id" | "created_by_id" | "created_at" | "updated_at" | "group" | "status"> & { status?: TeamListing["status"] }
): Promise<TeamListing> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("team_listings")
    .insert({
      ...input,
      group_id: groupId,
      created_by_id: auth.user.id,
      status: input.status ?? "open",
    })
    .select(
      `id, group_id, created_by_id, title, description, format, ntrp_min, ntrp_max, city, status, expires_at, created_at, updated_at,
       group:groups!team_listings_group_id_fkey ( id, name, image_url )`
    )
    .single();
  if (error) throw error;
  return data as unknown as TeamListing;
}

// ---------------------------------------------------------------------
// Group invites (token-based join links)
// ---------------------------------------------------------------------

export interface GroupInvite {
  id: string;
  group_id: string;
  email: string;
  invited_by_id: string;
  token: string;
  role: "owner" | "manager" | "captain" | "member";
  member_type: string;
  status: "pending" | "accepted" | "cancelled" | "expired";
  expires_at: string;
  accepted_by_id: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
  group?: { id: string; name: string; image_url: string };
}

export async function validateInvite(
  supabase: SupabaseClient<Database>,
  token: string
): Promise<GroupInvite | null> {
  const { data, error } = await supabase
    .from("group_invites")
    .select(
      `id, group_id, email, invited_by_id, token, role, member_type, status, expires_at, accepted_by_id, accepted_at, created_at, updated_at,
       group:groups!group_invites_group_id_fkey ( id, name, image_url )`
    )
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as GroupInvite | null) ?? null;
}

export async function acceptInvite(
  supabase: SupabaseClient<Database>,
  inviteId: string,
  groupId: string,
  role: GroupInvite["role"],
  memberType: string
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");

  const { error: memberErr } = await supabase
    .from("group_members")
    .upsert(
      {
        group_id: groupId,
        user_id: auth.user.id,
        role,
        member_type: memberType,
      },
      { onConflict: "group_id,user_id" }
    );
  if (memberErr) throw memberErr;

  const { error: invErr } = await supabase
    .from("group_invites")
    .update({
      status: "accepted",
      accepted_by_id: auth.user.id,
      accepted_at: new Date().toISOString(),
    })
    .eq("id", inviteId);
  if (invErr) throw invErr;
}

// ---------------------------------------------------------------------
// Friend groups
// ---------------------------------------------------------------------

export interface FriendGroup {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface FriendGroupMember {
  id: string;
  friend_group_id: string;
  user_id: string;
  created_at: string;
  user: { id: string; name: string; profile_image_url: string };
}

export async function listMyFriendGroups(
  supabase: SupabaseClient<Database>
): Promise<FriendGroup[]> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await supabase
    .from("friend_groups")
    .select("id, name, owner_id, created_at, updated_at")
    .eq("owner_id", auth.user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as FriendGroup[];
}

export async function listFriendGroupMembers(
  supabase: SupabaseClient<Database>,
  fgId: string
): Promise<FriendGroupMember[]> {
  const { data, error } = await supabase
    .from("friend_group_members")
    .select(
      `id, friend_group_id, user_id, created_at,
       user:profiles!friend_group_members_user_id_fkey ( id, name, profile_image_url )`
    )
    .eq("friend_group_id", fgId);
  if (error) throw error;
  return (data ?? []) as unknown as FriendGroupMember[];
}

export async function createFriendGroup(
  supabase: SupabaseClient<Database>,
  name: string,
  memberIds: string[]
): Promise<FriendGroup> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("friend_groups")
    .insert({ name, owner_id: auth.user.id })
    .select("id, name, owner_id, created_at, updated_at")
    .single();
  if (error) throw error;
  if (memberIds.length > 0) {
    const rows = memberIds.map((uid) => ({
      friend_group_id: data.id,
      user_id: uid,
    }));
    const { error: mErr } = await supabase.from("friend_group_members").insert(rows);
    if (mErr) throw mErr;
  }
  return data as FriendGroup;
}

export async function deleteFriendGroup(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<void> {
  const { error } = await supabase.from("friend_groups").delete().eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Reactions (polymorphic: dm | group | chat)
// ---------------------------------------------------------------------

export type ReactionTarget = "dm" | "group" | "chat";

export interface MessageReaction {
  id: string;
  target_type: ReactionTarget;
  target_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export async function addReaction(
  supabase: SupabaseClient<Database>,
  targetType: ReactionTarget,
  targetId: string,
  emoji: string
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("message_reactions")
    .insert({
      target_type: targetType,
      target_id: targetId,
      user_id: auth.user.id,
      emoji,
    });
  if (error && !error.message.includes("duplicate")) throw error;
}

export async function removeReaction(
  supabase: SupabaseClient<Database>,
  targetType: ReactionTarget,
  targetId: string,
  emoji: string
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("message_reactions")
    .delete()
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("user_id", auth.user.id)
    .eq("emoji", emoji);
  if (error) throw error;
}

export interface MessageReactionWithUser extends MessageReaction {
  user: { id: string; name: string };
}

/** Batch-fetch reactions for a set of messages of one target_type.
 *  RLS already scopes visibility (a DM reaction is only visible if the
 *  viewer can see the parent message), so callers don't have to do their
 *  own filtering. */
export async function listReactionsForMessages(
  supabase: SupabaseClient<Database>,
  targetType: ReactionTarget,
  targetIds: string[]
): Promise<MessageReactionWithUser[]> {
  if (targetIds.length === 0) return [];
  const { data, error } = await supabase
    .from("message_reactions")
    .select(
      `id, target_type, target_id, user_id, emoji, created_at,
       user:profiles!message_reactions_user_id_fkey ( id, name )`
    )
    .eq("target_type", targetType)
    .in("target_id", targetIds);
  if (error) throw error;
  return (data ?? []) as unknown as MessageReactionWithUser[];
}

// ---------------------------------------------------------------------
// Highlights (story-style media on profile)
// ---------------------------------------------------------------------

export interface Highlight {
  id: string;
  user_id: string;
  media_url: string;
  media_type: string;
  caption: string;
  created_at: string;
}

export async function listHighlights(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<Highlight[]> {
  const { data, error } = await supabase
    .from("highlights")
    .select("id, user_id, media_url, media_type, caption, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Highlight[];
}

export async function addHighlight(
  supabase: SupabaseClient<Database>,
  input: { mediaUrl: string; mediaType?: string; caption?: string }
): Promise<Highlight> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("highlights")
    .insert({
      user_id: auth.user.id,
      media_url: input.mediaUrl,
      media_type: input.mediaType ?? "image",
      caption: input.caption ?? "",
    })
    .select("id, user_id, media_url, media_type, caption, created_at")
    .single();
  if (error) throw error;
  return data as Highlight;
}

export async function deleteHighlight(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<void> {
  const { error } = await supabase.from("highlights").delete().eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Device tokens
// ---------------------------------------------------------------------

export async function registerDeviceToken(
  supabase: SupabaseClient<Database>,
  token: string,
  platform: "ios" | "android"
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return;
  const { error } = await supabase.from("device_tokens").upsert(
    {
      user_id: auth.user.id,
      token,
      platform,
    },
    { onConflict: "token" }
  );
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Play requests (join-a-game)
// ---------------------------------------------------------------------

export interface PlayRequest {
  id: string;
  post_id: string;
  user_id: string;
  status: "pending" | "approved" | "rejected";
  note: string;
  created_at: string;
  updated_at: string;
  user?: { id: string; name: string; profile_image_url: string };
}

export async function requestToJoin(
  supabase: SupabaseClient<Database>,
  postId: string,
  note: string = ""
): Promise<PlayRequest> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("play_requests")
    .insert({
      post_id: postId,
      user_id: auth.user.id,
      status: "pending",
      note,
    })
    .select("id, post_id, user_id, status, note, created_at, updated_at")
    .single();
  if (error) throw error;
  return data as PlayRequest;
}

export async function cancelPlayRequest(
  supabase: SupabaseClient<Database>,
  postId: string
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("play_requests")
    .delete()
    .eq("post_id", postId)
    .eq("user_id", auth.user.id);
  if (error) throw error;
}

export async function respondToPlayRequest(
  supabase: SupabaseClient<Database>,
  requestId: string,
  decision: "approved" | "rejected"
): Promise<void> {
  const { error } = await supabase
    .from("play_requests")
    .update({ status: decision })
    .eq("id", requestId);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Polls
// ---------------------------------------------------------------------

export async function createPollInGroup(
  supabase: SupabaseClient<Database>,
  groupId: string,
  input: { question: string; options: string[]; isMulti?: boolean }
): Promise<{ pollId: string; messageId: string }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");

  // polls is a standalone table; group association comes via group_messages.poll_id.
  void groupId;
  const { data: poll, error: pollErr } = await supabase
    .from("polls")
    .insert({
      question: input.question,
      is_multi: input.isMulti ?? false,
      created_by_id: auth.user.id,
    })
    .select("id")
    .single();
  if (pollErr || !poll) throw pollErr ?? new Error("poll insert failed");

  const optionRows = input.options.map((text, i) => ({
    poll_id: poll.id,
    text,
    order: i,
  }));
  const { error: optErr } = await supabase.from("poll_options").insert(optionRows);
  if (optErr) throw optErr;

  const { data: message, error: msgErr } = await supabase
    .from("group_messages")
    .insert({
      group_id: groupId,
      sender_id: auth.user.id,
      content: input.question,
      poll_id: poll.id,
      kind: "chat",
    })
    .select("id")
    .single();
  if (msgErr || !message) throw msgErr ?? new Error("group_messages insert failed");

  return { pollId: poll.id, messageId: message.id };
}

export async function votePoll(
  supabase: SupabaseClient<Database>,
  pollId: string,
  optionIds: string[]
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  await supabase
    .from("poll_votes")
    .delete()
    .eq("poll_id", pollId)
    .eq("user_id", auth.user.id);
  if (optionIds.length > 0) {
    const rows = optionIds.map((oid) => ({
      poll_id: pollId,
      option_id: oid,
      user_id: auth.user!.id,
    }));
    const { error } = await supabase.from("poll_votes").insert(rows);
    if (error) throw error;
  }
}

export async function setPollClosed(
  supabase: SupabaseClient<Database>,
  pollId: string,
  isClosed: boolean
): Promise<void> {
  const { error } = await supabase
    .from("polls")
    .update({ is_closed: isClosed })
    .eq("id", pollId);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Dashboard aggregator
// ---------------------------------------------------------------------

export interface DashboardUpcoming {
  events: Array<{
    id: string;
    title: string;
    start_date: string;
    venue_name: string;
    event_type: string;
  }>;
  teamMatches: Array<{
    id: string;
    group_id: string;
    match_date: string;
    match_time: string;
    location: string;
    opponent: string;
    group: { id: string; name: string };
  }>;
}

export async function getDashboardUpcoming(
  supabase: SupabaseClient<Database>
): Promise<DashboardUpcoming> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { events: [], teamMatches: [] };

  const now = new Date().toISOString();
  const horizon = new Date(Date.now() + 14 * 86400_000).toISOString();

  const [partRes, matchesRes] = await Promise.all([
    supabase
      .from("event_participants")
      .select(
        `event_id,
         event:events!event_participants_event_id_fkey ( id, title, start_date, venue_name, event_type, status, end_date )`
      )
      .eq("user_id", auth.user.id)
      .eq("status", "registered"),
    supabase
      .from("team_matches")
      .select(
        `id, group_id, match_date, match_time, location, opponent,
         group:groups!team_matches_group_id_fkey ( id, name )`
      )
      .gte("match_date", now.slice(0, 10))
      .lte("match_date", horizon.slice(0, 10)),
  ]);
  if (partRes.error) throw partRes.error;
  if (matchesRes.error) throw matchesRes.error;

  const events = ((partRes.data ?? []) as unknown as Array<{
    event: {
      id: string;
      title: string;
      start_date: string;
      venue_name: string;
      event_type: string;
      status: string;
      end_date: string;
    };
  }>)
    .map((row) => row.event)
    .filter((e) => e && e.start_date >= now && e.start_date <= horizon && e.status !== "cancelled")
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  return {
    events,
    teamMatches: (matchesRes.data ?? []) as unknown as DashboardUpcoming["teamMatches"],
  };
}
