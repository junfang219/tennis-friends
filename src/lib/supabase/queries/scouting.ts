"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";
import type { TeamSearchResult } from "@/lib/tennisrecord/parse";

export type { TeamSearchResult };

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
  is_own: boolean;
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
  "is_own, last_fetched_at, fetch_status, fetch_error, created_at, updated_at";

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

export interface LeagueScheduleMatch {
  dateISO: string;
  timeRaw: string;
  time: string | null;
  opponentName: string;
  opponentHref: string;
  matchSite: string;
  resultText: string;
}

export interface LeagueScoutResult {
  ownTeam: OpponentTeam;
  ownPlayers: OpponentPlayer[];
  schedule: LeagueScheduleMatch[];
  opponents: { team: OpponentTeam; players: OpponentPlayer[]; warning?: string }[];
  warnings: string[];
}

// Find a team on tennisrecord by name (+ optional filters) so the captain can
// pick theirs without hunting for a URL. Returns the candidate teams; the
// chosen one's `teamUrl` feeds scoutLeague() to import its schedule.
export async function searchTeams(
  groupId: string,
  params: {
    teamName: string;
    year?: string;
    section?: string;
    leagueType?: string;
  },
): Promise<TeamSearchResult[]> {
  const res = await fetch(`/api/groups/${groupId}/scouting/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error ?? "Could not search tennisrecord.");
  }
  return (json.results ?? []) as TeamSearchResult[];
}

export interface TeamPreview {
  teamName: string;
  players: {
    name: string;
    ntrpRating: number | null;
    dynamicRating: number | null;
    recordRaw: string;
  }[];
  schedule: LeagueScheduleMatch[];
}

// Read-only roster + schedule preview for a candidate team, so the captain can
// confirm it's theirs (recognize teammates) before committing the import.
export async function previewTeam(
  groupId: string,
  url: string,
): Promise<TeamPreview> {
  const res = await fetch(`/api/groups/${groupId}/scouting/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error ?? "Could not load that team.");
  }
  return json as TeamPreview;
}

// One-paste league scouting: pass the captain's OWN team link; the server
// discovers and scouts every opponent from the page's Local Schedule.
export async function scoutLeague(
  groupId: string,
  input: { url: string },
): Promise<LeagueScoutResult> {
  const res = await fetch(`/api/groups/${groupId}/scouting/league`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error ?? "Could not scout the league.");
  }
  return json as LeagueScoutResult;
}

// Import league-schedule rows into team_matches (insert-only; existing
// matches on the same date vs the same opponent are skipped).
export async function importSchedule(
  groupId: string,
  matches: LeagueScheduleMatch[],
): Promise<{ imported: number; skipped: number }> {
  const res = await fetch(`/api/groups/${groupId}/scouting/import-schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      matches: matches.map((m) => ({
        dateISO: m.dateISO,
        time: m.time,
        opponentName: m.opponentName,
        opponentHref: m.opponentHref,
        matchSite: m.matchSite,
      })),
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error ?? "Could not import the schedule.");
  }
  return json as { imported: number; skipped: number };
}
