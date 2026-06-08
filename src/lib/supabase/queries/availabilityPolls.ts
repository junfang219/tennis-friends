"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";
import type { Block } from "../../availabilityPoll";

export interface AvailabilityPoll {
  id: string;
  group_id: string;
  created_by_id: string;
  title: string;
  candidate_dates: string[];
  min_players: number;
  min_block_minutes: number;
  timezone: string;
  status: "open" | "closed";
  closed_at: string | null;
  resulting_match_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PollResponse {
  id: string;
  poll_id: string;
  user_id: string;
  blocks: Block[];
  note: string;
  created_at: string;
  updated_at: string;
}

const POLL_COLUMNS =
  "id, group_id, created_by_id, title, candidate_dates, min_players, min_block_minutes, " +
  "timezone, status, closed_at, resulting_match_id, created_at, updated_at";

const RESPONSE_COLUMNS = "id, poll_id, user_id, blocks, note, created_at, updated_at";

export async function listGroupPolls(
  supabase: SupabaseClient<Database>,
  groupId: string,
): Promise<AvailabilityPoll[]> {
  const { data, error } = await supabase
    .from("availability_polls")
    .select(POLL_COLUMNS)
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as AvailabilityPoll[];
}

export async function getPoll(
  supabase: SupabaseClient<Database>,
  pollId: string,
): Promise<AvailabilityPoll | null> {
  const { data, error } = await supabase
    .from("availability_polls")
    .select(POLL_COLUMNS)
    .eq("id", pollId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as AvailabilityPoll | null;
}

export async function listPollResponses(
  supabase: SupabaseClient<Database>,
  pollId: string,
): Promise<PollResponse[]> {
  const { data, error } = await supabase
    .from("availability_poll_responses")
    .select(RESPONSE_COLUMNS)
    .eq("poll_id", pollId);
  if (error) throw error;
  return ((data ?? []) as unknown as PollResponse[]).map((r) => ({
    ...r,
    blocks: Array.isArray(r.blocks) ? r.blocks : [],
  }));
}

// Replace the caller's blocks for a poll in a single upsert. The unique
// (poll_id, user_id) index turns this into UPDATE when a row already exists.
export async function upsertMyResponse(
  supabase: SupabaseClient<Database>,
  args: { pollId: string; userId: string; blocks: Block[]; note?: string },
): Promise<void> {
  const { error } = await supabase
    .from("availability_poll_responses")
    .upsert(
      {
        poll_id: args.pollId,
        user_id: args.userId,
        blocks: args.blocks as unknown as Database["public"]["Tables"]["availability_poll_responses"]["Insert"]["blocks"],
        note: args.note ?? "",
      },
      { onConflict: "poll_id,user_id" },
    );
  if (error) throw error;
}

export async function deleteMyResponse(
  supabase: SupabaseClient<Database>,
  args: { pollId: string; userId: string },
): Promise<void> {
  const { error } = await supabase
    .from("availability_poll_responses")
    .delete()
    .eq("poll_id", args.pollId)
    .eq("user_id", args.userId);
  if (error) throw error;
}

export async function closePoll(
  supabase: SupabaseClient<Database>,
  args: { pollId: string; resultingMatchId?: string },
): Promise<void> {
  const { error } = await supabase
    .from("availability_polls")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      ...(args.resultingMatchId ? { resulting_match_id: args.resultingMatchId } : {}),
    })
    .eq("id", args.pollId);
  if (error) throw error;
}

// One availability row joined with the player profile — the shape returned by
// seedPlayingAvailability so callers can render the seeded "Playing" cells.
export interface SeededAvailabilityRow {
  id: string;
  user_id: string;
  status: string;
  match_types: string;
  lineup_slot: string;
  user: { id: string; name: string; profile_image_url: string };
}

const SEEDED_AVAILABILITY_COLUMNS =
  `id, user_id, status, match_types, lineup_slot, ` +
  `user:profiles!availabilities_user_id_fkey ( id, name, profile_image_url )`;

// Pure row builder (unit-testable): mark the window's members "playing" and
// everyone else on the team "not_playing" on a match. match_types is left blank
// — the poll captured *when* people can play, not singles-vs-doubles, so that
// stays for members/captain to fill in later.
export function buildSeededAvailabilityRows(
  matchId: string,
  groups: { playing: string[]; notPlaying: string[] },
) {
  const row = (user_id: string, status: "playing" | "not_playing") => ({
    event_kind: "match" as const,
    match_id: matchId,
    user_id,
    status,
    match_types: "",
  });
  return [
    ...groups.playing.map((u) => row(u, "playing")),
    ...groups.notPlaying.map((u) => row(u, "not_playing")),
  ];
}

// Seed availability for everyone on the team when the captain converts a poll
// window into a match: members who could make the window are marked "playing",
// the rest "not_playing". They already answered the poll, so this saves them
// re-marking it. Upsert (on match_id,user_id) so it never clobbers a
// pre-existing response. Captain-only via RLS
// (availabilities_insert_self_or_captain).
export async function seedPollAvailability(
  supabase: SupabaseClient<Database>,
  args: { matchId: string; playingUserIds: string[]; notPlayingUserIds: string[] },
): Promise<SeededAvailabilityRow[]> {
  const rows = buildSeededAvailabilityRows(args.matchId, {
    playing: args.playingUserIds,
    notPlaying: args.notPlayingUserIds,
  });
  if (rows.length === 0) return [];
  const { data, error } = await supabase
    .from("availabilities")
    .upsert(rows, { onConflict: "match_id,user_id" })
    .select(SEEDED_AVAILABILITY_COLUMNS);
  if (error) throw error;
  return (data ?? []) as unknown as SeededAvailabilityRow[];
}

export async function deletePoll(
  supabase: SupabaseClient<Database>,
  pollId: string,
): Promise<void> {
  const { error } = await supabase
    .from("availability_polls")
    .delete()
    .eq("id", pollId);
  if (error) throw error;
}
