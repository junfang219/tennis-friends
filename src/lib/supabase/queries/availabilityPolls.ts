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
