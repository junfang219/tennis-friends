import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  fetchTennisRecordTeam,
  TennisRecordFetchError,
} from "@/lib/tennisrecord/fetch";
import {
  parseTeamProfile,
  parseSchedule,
  discoverOpponentLinks,
} from "@/lib/tennisrecord/parse";
import {
  upsertOpponentTeam,
  selectTeamsWithPlayers,
} from "@/lib/tennisrecord/persist";

// POST /api/groups/[id]/scouting/league
//
// One-paste league scouting: the captain pastes their OWN team's tennisrecord
// link. We fetch that page, parse the Local Schedule, discover every opponent
// team link, then sequentially fetch + parse each opponent's roster. The own
// team is cached as an opponent_teams row with is_own = true; opponents as
// regular rows. Per-opponent failures are soft (row saved with fetch_status
// 'error', batch continues). Captain-only via RLS (42501 → 403).
//
// Sequential fan-out of up to MAX_OPPONENTS fetches with a politeness delay —
// allow up to a minute.
export const maxDuration = 60;

const MAX_OPPONENTS = 12;
const FETCH_DELAY_MS = 250;

const Body = z.object({
  url: z.string().trim().min(1, "Paste your team's tennisrecord link.").max(2000),
});

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    return await leagueScout(req, ctx);
  } catch (err) {
    // Surface unexpected failures as JSON (an empty 500 gives the UI nothing
    // to show) — the fan-out makes this route the most failure-prone one.
    console.error("league scout failed:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Could not scout the league.",
      },
      { status: 500 },
    );
  }
}

async function leagueScout(
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

  // 1. Own team page — required; hard-fail if unreachable/unparseable.
  let ownHtml: string;
  let ownResolvedUrl: string;
  let ownTeamKey: string;
  let ownUrlTeamName: string | undefined;
  try {
    const result = await fetchTennisRecordTeam({ url: parsed.url });
    ownHtml = result.html;
    ownResolvedUrl = result.resolvedUrl;
    ownTeamKey = result.teamKey;
    ownUrlTeamName = result.urlTeamName;
  } catch (err) {
    if (err instanceof TennisRecordFetchError) {
      const code = err.status ? 502 : 400;
      return NextResponse.json({ error: err.message }, { status: code });
    }
    return NextResponse.json(
      { error: "Could not reach tennisrecord." },
      { status: 502 },
    );
  }

  const ownProfile = parseTeamProfile(ownHtml);
  const ownName = ownProfile.teamName || ownUrlTeamName || "My team";
  const schedule = parseSchedule(ownHtml);
  const warnings: string[] = [];
  if (schedule.length === 0) {
    warnings.push(
      "No league schedule found on that page — opponents could not be discovered.",
    );
  }

  // 2. Cache the own team (roster included — your own players' ratings).
  const ownResult = await upsertOpponentTeam(supabase, groupId, {
    teamKey: ownTeamKey,
    name: ownName,
    resolvedUrl: ownResolvedUrl,
    createdById: me,
    isOwn: true,
    fetchStatus: "ok",
    fetchError: "",
    players: ownProfile.players,
  });
  if ("error" in ownResult) {
    return NextResponse.json(
      { error: ownResult.error },
      { status: ownResult.status },
    );
  }

  // 3. Discover opponents from the schedule; never scout ourselves.
  let links = discoverOpponentLinks(schedule).filter(
    (l) => l.teamKey !== ownTeamKey,
  );
  if (links.length > MAX_OPPONENTS) {
    warnings.push(
      `Found ${links.length} opponents; scouting the first ${MAX_OPPONENTS}.`,
    );
    links = links.slice(0, MAX_OPPONENTS);
  }

  // 4. Sequential fan-out with politeness delay; per-opponent soft-fail.
  const scoutedIds: { teamId: string; warning?: string }[] = [];
  for (const link of links) {
    await delay(FETCH_DELAY_MS);

    let fetchStatus: "ok" | "error" = "ok";
    let fetchError = "";
    let name = link.name;
    let resolvedUrl = link.teamUrl;
    let players: ReturnType<typeof parseTeamProfile>["players"] = [];
    try {
      const result = await fetchTennisRecordTeam({ url: link.teamUrl });
      resolvedUrl = result.resolvedUrl;
      const profile = parseTeamProfile(result.html);
      name = profile.teamName || link.name;
      players = profile.players;
      if (players.length === 0) {
        fetchStatus = "error";
        fetchError = "Page loaded but no roster was found.";
      }
    } catch (err) {
      fetchStatus = "error";
      fetchError =
        err instanceof Error ? err.message : "Could not fetch this team.";
    }

    const upserted = await upsertOpponentTeam(supabase, groupId, {
      teamKey: link.teamKey,
      name,
      resolvedUrl,
      createdById: me,
      isOwn: false,
      fetchStatus,
      fetchError,
      players,
    });
    if ("error" in upserted) {
      // RLS/database failure — applies to the whole batch, stop here.
      return NextResponse.json(
        { error: upserted.error },
        { status: upserted.status },
      );
    }

    scoutedIds.push({
      teamId: upserted.teamId,
      ...(fetchStatus === "error" ? { warning: fetchError } : {}),
    });
  }

  // 5. Assemble the response in two batched queries (per-team round-trips
  // would dominate the fan-out time).
  const { teams, players: playersByTeam } = await selectTeamsWithPlayers(
    supabase,
    [ownResult.teamId, ...scoutedIds.map((s) => s.teamId)],
  );
  const opponents = scoutedIds.map((s) => ({
    team: teams.get(s.teamId) ?? null,
    players: playersByTeam.get(s.teamId) ?? [],
    ...(s.warning ? { warning: s.warning } : {}),
  }));

  return NextResponse.json(
    {
      ownTeam: teams.get(ownResult.teamId) ?? null,
      ownPlayers: playersByTeam.get(ownResult.teamId) ?? [],
      schedule,
      opponents,
      warnings,
    },
    { status: 200 },
  );
}
