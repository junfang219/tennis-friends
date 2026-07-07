import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { ParsedPlayer } from "./parse";

// Shared persistence for scouted tennisrecord teams — used by both the
// single-opponent route (POST …/scouting) and the league fan-out route
// (POST …/scouting/league). Runs under the caller's RLS-scoped server client,
// so captain-only writes are enforced by the opponent_teams policies
// (42501 → 403 at the call sites).

export const TEAM_COLUMNS =
  "id, group_id, name, source, source_url, source_team_key, linked_group_id, " +
  "is_own, last_fetched_at, fetch_status, fetch_error, created_at, updated_at";

export const PLAYER_COLUMNS =
  "id, opponent_team_id, name, source_player_url, ntrp_rating, dynamic_rating, " +
  "wins, losses, record_raw, order, created_at";

export type UpsertTeamParams = {
  teamKey: string;
  name: string;
  resolvedUrl: string;
  createdById: string;
  isOwn: boolean;
  fetchStatus: "ok" | "error";
  fetchError: string;
  // Replaces the cached roster when fetchStatus is "ok"; on "error" the
  // previously cached roster (if any) is kept rather than wiped.
  players: ParsedPlayer[];
};

export type UpsertTeamResult =
  | {
      teamId: string;
      // True only when this was an OWN-team import that took over the group's
      // own-team slot from a *different* previously-imported team (the "I
      // imported the wrong team, re-import the right one" case). Lets the
      // caller clear the stale imported schedule so the newest import wins.
      ownReplaced?: boolean;
    }
  | { error: string; status: number };

export async function upsertOpponentTeam(
  supabase: SupabaseClient<Database>,
  groupId: string,
  params: UpsertTeamParams,
): Promise<UpsertTeamResult> {
  const {
    teamKey,
    name,
    resolvedUrl,
    createdById,
    isOwn,
    fetchStatus,
    fetchError,
    players,
  } = params;

  // Only one own team is allowed per group (opponent_teams_one_own_per_group,
  // a partial unique index on group_id WHERE is_own). When importing the OWN
  // team, if a *different* team currently holds that slot — e.g. the captain
  // imported the wrong team first — remove it so the newest import always
  // takes over instead of hitting the unique index. Re-importing the SAME
  // team (matching source_team_key) is left to the update path below, which
  // preserves its cached data.
  let ownReplaced = false;
  if (isOwn) {
    const { data: currentOwn } = await supabase
      .from("opponent_teams")
      .select("id, source_team_key")
      .eq("group_id", groupId)
      .eq("is_own", true)
      .maybeSingle();
    if (currentOwn && currentOwn.source_team_key !== teamKey) {
      const { error: delErr } = await supabase
        .from("opponent_teams")
        .delete()
        .eq("id", currentOwn.id);
      if (delErr) {
        return {
          error: delErr.message,
          status: delErr.code === "42501" ? 403 : 400,
        };
      }
      ownReplaced = true;
    }
  }

  // The partial unique index (group_id, source_team_key) can't be an
  // onConflict target, so look the row up explicitly.
  const { data: existing } = await supabase
    .from("opponent_teams")
    .select("id")
    .eq("group_id", groupId)
    .eq("source_team_key", teamKey)
    .maybeSingle();

  const fetchedAt = new Date().toISOString();
  let opponentTeamId: string;
  if (existing) {
    // is_own is set on the update path too: an opponent previously scouted
    // manually that turns out to be the captain's own team flips to own.
    const { data: updated, error: updErr } = await supabase
      .from("opponent_teams")
      .update({
        name,
        source_url: resolvedUrl,
        is_own: isOwn,
        last_fetched_at: fetchedAt,
        fetch_status: fetchStatus,
        fetch_error: fetchError,
      })
      .eq("id", existing.id)
      .select("id")
      .single();
    if (updErr || !updated) {
      return {
        error: updErr?.message ?? "Could not save opponent.",
        status: updErr?.code === "42501" ? 403 : 400,
      };
    }
    opponentTeamId = updated.id;
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from("opponent_teams")
      .insert({
        group_id: groupId,
        name,
        source: "tennisrecord",
        source_url: resolvedUrl,
        source_team_key: teamKey,
        is_own: isOwn,
        last_fetched_at: fetchedAt,
        fetch_status: fetchStatus,
        fetch_error: fetchError,
        created_by_id: createdById,
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      return {
        error: insErr?.message ?? "Could not save opponent.",
        status: insErr?.code === "42501" ? 403 : 400,
      };
    }
    opponentTeamId = inserted.id;
  }

  // Replace the cached roster snapshot only on a successful fetch.
  if (fetchStatus === "ok") {
    await supabase
      .from("opponent_players")
      .delete()
      .eq("opponent_team_id", opponentTeamId);

    if (players.length > 0) {
      const { error: playersErr } = await supabase
        .from("opponent_players")
        .insert(
          players.map((p, i) => ({
            opponent_team_id: opponentTeamId,
            name: p.name,
            source_player_url: p.sourcePlayerUrl,
            ntrp_rating: p.ntrpRating,
            dynamic_rating: p.dynamicRating,
            wins: p.wins,
            losses: p.losses,
            record_raw: p.recordRaw,
            order: i,
          })),
        );
      if (playersErr) {
        return { error: playersErr.message, status: 400 };
      }
    }
  }

  return { teamId: opponentTeamId, ownReplaced };
}

// Fetch a saved team + roster in the shape the scouting UI consumes.
export async function selectTeamWithPlayers(
  supabase: SupabaseClient<Database>,
  teamId: string,
) {
  const { data: team } = await supabase
    .from("opponent_teams")
    .select(TEAM_COLUMNS)
    .eq("id", teamId)
    .single();

  const { data: players } = await supabase
    .from("opponent_players")
    .select(PLAYER_COLUMNS)
    .eq("opponent_team_id", teamId)
    .order("order", { ascending: true });

  return { team, players: players ?? [] };
}

// Batch variant for the league fan-out: two queries for the whole league
// instead of two per team (the per-team round-trips dominate fan-out time).
export async function selectTeamsWithPlayers(
  supabase: SupabaseClient<Database>,
  teamIds: string[],
) {
  if (teamIds.length === 0) {
    return { teams: new Map(), players: new Map() };
  }
  const [{ data: teamRows }, { data: playerRows }] = await Promise.all([
    supabase.from("opponent_teams").select(TEAM_COLUMNS).in("id", teamIds),
    supabase
      .from("opponent_players")
      .select(PLAYER_COLUMNS)
      .in("opponent_team_id", teamIds)
      .order("order", { ascending: true }),
  ]);

  // supabase-js can't infer row shapes from the runtime column strings.
  type TeamRow = { id: string } & Record<string, unknown>;
  type PlayerRow = { opponent_team_id: string } & Record<string, unknown>;

  const teams = new Map(
    ((teamRows ?? []) as unknown as TeamRow[]).map((t) => [t.id, t] as const),
  );
  const players = new Map<string, PlayerRow[]>();
  for (const p of (playerRows ?? []) as unknown as PlayerRow[]) {
    const list = players.get(p.opponent_team_id) ?? [];
    list.push(p);
    players.set(p.opponent_team_id, list);
  }
  return { teams, players };
}
