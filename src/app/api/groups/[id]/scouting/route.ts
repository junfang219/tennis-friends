import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  fetchTennisRecordTeam,
  TennisRecordFetchError,
} from "@/lib/tennisrecord/fetch";
import { parseTeamProfile } from "@/lib/tennisrecord/parse";

// POST /api/groups/[id]/scouting
//
// Captain-only (enforced by RLS on opponent_teams / opponent_players). Takes a
// tennisrecord team URL (or bare team key), fetches + parses the public roster,
// then upserts one opponent_teams row for this group and replaces its cached
// opponent_players. Used for both first-time scouting and refresh.
//
// Response: 200 + { team, players }. Errors: 400 bad input, 401 unauth,
// 403 not a captain, 502 tennisrecord unreachable/blocked.

const Body = z
  .object({
    url: z.string().trim().max(2000).optional(),
    teamName: z.string().trim().max(200).optional(),
  })
  .refine((v) => (v.url && v.url.length > 0) || (v.teamName && v.teamName.length > 0), {
    message: "Paste a tennisrecord team link.",
  });

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: groupId } = await ctx.params;
  const supabase = await createSupabaseServerClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const me = auth.user.id;

  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    const msg =
      err instanceof z.ZodError
        ? err.issues.map((i) => i.message).join("; ")
        : "Bad request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Fetch + parse the tennisrecord page.
  let html: string;
  let resolvedUrl: string;
  let teamKey: string;
  let urlTeamName: string | undefined;
  try {
    const result = await fetchTennisRecordTeam(parsed);
    html = result.html;
    resolvedUrl = result.resolvedUrl;
    teamKey = result.teamKey;
    urlTeamName = result.urlTeamName;
  } catch (err) {
    if (err instanceof TennisRecordFetchError) {
      // No status → bad input (unparseable link). Status → upstream failure.
      const code = err.status ? 502 : 400;
      return NextResponse.json({ error: err.message }, { status: code });
    }
    return NextResponse.json(
      { error: "Could not scout that team." },
      { status: 502 },
    );
  }

  const profile = parseTeamProfile(html);
  const name =
    profile.teamName || urlTeamName || parsed.teamName?.trim() || "Opponent team";

  // Upsert the opponent_teams row for (group, tennisrecord team). The partial
  // unique index can't be an onConflict target, so look it up explicitly.
  const { data: existing } = await supabase
    .from("opponent_teams")
    .select("id")
    .eq("group_id", groupId)
    .eq("source_team_key", teamKey)
    .maybeSingle();

  const teamRow = {
    group_id: groupId,
    name,
    source: "tennisrecord",
    source_url: resolvedUrl,
    source_team_key: teamKey,
    last_fetched_at: new Date().toISOString(),
    fetch_status: "ok",
    fetch_error: "",
    created_by_id: me,
  };

  let opponentTeamId: string;
  if (existing) {
    const { data: updated, error: updErr } = await supabase
      .from("opponent_teams")
      .update({
        name,
        source_url: resolvedUrl,
        last_fetched_at: teamRow.last_fetched_at,
        fetch_status: "ok",
        fetch_error: "",
      })
      .eq("id", existing.id)
      .select("id")
      .single();
    if (updErr || !updated) {
      const status = updErr?.code === "42501" ? 403 : 400;
      return NextResponse.json(
        { error: updErr?.message ?? "Could not save opponent." },
        { status },
      );
    }
    opponentTeamId = updated.id;
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from("opponent_teams")
      .insert(teamRow)
      .select("id")
      .single();
    if (insErr || !inserted) {
      const status = insErr?.code === "42501" ? 403 : 400;
      return NextResponse.json(
        { error: insErr?.message ?? "Could not save opponent." },
        { status },
      );
    }
    opponentTeamId = inserted.id;
  }

  // Replace the cached roster snapshot.
  await supabase
    .from("opponent_players")
    .delete()
    .eq("opponent_team_id", opponentTeamId);

  if (profile.players.length > 0) {
    const { error: playersErr } = await supabase.from("opponent_players").insert(
      profile.players.map((p, i) => ({
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
      return NextResponse.json({ error: playersErr.message }, { status: 400 });
    }
  }

  const { data: team } = await supabase
    .from("opponent_teams")
    .select(
      "id, group_id, name, source, source_url, source_team_key, linked_group_id, last_fetched_at, fetch_status, fetch_error, created_at, updated_at",
    )
    .eq("id", opponentTeamId)
    .single();

  const { data: players } = await supabase
    .from("opponent_players")
    .select(
      "id, opponent_team_id, name, source_player_url, ntrp_rating, dynamic_rating, wins, losses, record_raw, order, created_at",
    )
    .eq("opponent_team_id", opponentTeamId)
    .order("order", { ascending: true });

  return NextResponse.json({ team, players: players ?? [] }, { status: 200 });
}
