"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";

// Reads for the opponent-scouting feature. Adding/refreshing an opponent goes
// through POST /api/groups/[id]/scouting (it needs server-side network +
// HTML parsing); these helpers cover the client-side reads + light mutations
// (link to an in-app team, remove) that RLS already gates to captains.

export interface OpponentTeam {
  id: string;
  group_id: string;
  name: string;
  source: string;
  source_url: string;
  source_team_key: string;
  linked_group_id: string | null;
  last_fetched_at: string | null;
  fetch_status: string;
  fetch_error: string;
  created_at: string;
  updated_at: string;
}

export interface OpponentPlayer {
  id: string;
  opponent_team_id: string;
  name: string;
  source_player_url: string;
  ntrp_rating: number | null;
  dynamic_rating: number | null;
  wins: number;
  losses: number;
  record_raw: string;
  order: number;
}

const TEAM_COLUMNS =
  "id, group_id, name, source, source_url, source_team_key, linked_group_id, " +
  "last_fetched_at, fetch_status, fetch_error, created_at, updated_at";

const PLAYER_COLUMNS =
  "id, opponent_team_id, name, source_player_url, ntrp_rating, dynamic_rating, " +
  "wins, losses, record_raw, order";

export async function listOpponents(
  supabase: SupabaseClient<Database>,
  groupId: string,
): Promise<OpponentTeam[]> {
  const { data, error } = await supabase
    .from("opponent_teams")
    .select(TEAM_COLUMNS)
    .eq("group_id", groupId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as OpponentTeam[];
}

export async function getOpponentPlayers(
  supabase: SupabaseClient<Database>,
  opponentTeamId: string,
): Promise<OpponentPlayer[]> {
  const { data, error } = await supabase
    .from("opponent_players")
    .select(PLAYER_COLUMNS)
    .eq("opponent_team_id", opponentTeamId)
    .order("order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as OpponentPlayer[];
}

export async function linkOpponentToGroup(
  supabase: SupabaseClient<Database>,
  opponentTeamId: string,
  linkedGroupId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("opponent_teams")
    .update({ linked_group_id: linkedGroupId })
    .eq("id", opponentTeamId);
  if (error) throw error;
}

export async function deleteOpponent(
  supabase: SupabaseClient<Database>,
  opponentTeamId: string,
): Promise<void> {
  const { error } = await supabase
    .from("opponent_teams")
    .delete()
    .eq("id", opponentTeamId);
  if (error) throw error;
}

// Add or refresh an opponent by tennisrecord URL/name. Returns the team +
// roster. Throws an Error with the server's message on failure.
export async function scoutOpponent(
  groupId: string,
  input: { url?: string; teamName?: string },
): Promise<{ team: OpponentTeam; players: OpponentPlayer[] }> {
  const res = await fetch(`/api/groups/${groupId}/scouting`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error ?? "Could not scout that team.");
  }
  return json as { team: OpponentTeam; players: OpponentPlayer[] };
}
