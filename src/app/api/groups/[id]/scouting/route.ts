import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  fetchTennisRecordTeam,
  TennisRecordFetchError,
} from "@/lib/tennisrecord/fetch";
import { parseTeamProfile } from "@/lib/tennisrecord/parse";
import {
  upsertOpponentTeam,
  selectTeamWithPlayers,
} from "@/lib/tennisrecord/persist";

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
      // Validation → bad input (unparseable link). Network/upstream → 502.
      const code = err.kind === "validation" ? 400 : 502;
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

  const result = await upsertOpponentTeam(supabase, groupId, {
    teamKey,
    name,
    resolvedUrl,
    createdById: me,
    isOwn: false,
    fetchStatus: "ok",
    fetchError: "",
    players: profile.players,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { team, players } = await selectTeamWithPlayers(supabase, result.teamId);
  return NextResponse.json({ team, players }, { status: 200 });
}
