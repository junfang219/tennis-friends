import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  fetchTennisRecordTeam,
  TennisRecordFetchError,
} from "@/lib/tennisrecord/fetch";
import { parseTeamProfile, parseSchedule } from "@/lib/tennisrecord/parse";

// POST /api/groups/[id]/scouting/preview
//
// Read-only roster + schedule preview for ONE tennisrecord team URL. Used after
// a team search so the captain can confirm they picked the right team (by
// recognizing teammates) BEFORE committing — important because same-named teams
// can be indistinguishable by the search columns alone. No DB writes, so the
// captain can preview several candidates without tripping the one-own-per-group
// constraint. Committing happens via the league + import-schedule routes.
//
// Body: { url }
// 200:  { teamName, players: {name, ntrpRating, dynamicRating, recordRaw}[],
//         schedule: ScheduledMatch[] }

const Body = z.object({
  url: z.string().trim().min(1, "Pick a team to preview.").max(2000),
});

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  try {
    const { html, urlTeamName } = await fetchTennisRecordTeam({
      url: parsed.url,
    });
    const profile = parseTeamProfile(html);
    const schedule = parseSchedule(html);
    return NextResponse.json(
      {
        teamName: profile.teamName || urlTeamName || "",
        players: profile.players.map((p) => ({
          name: p.name,
          ntrpRating: p.ntrpRating,
          dynamicRating: p.dynamicRating,
          recordRaw: p.recordRaw,
        })),
        schedule,
      },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof TennisRecordFetchError) {
      const code = err.status ? 502 : 400;
      return NextResponse.json({ error: err.message }, { status: code });
    }
    return NextResponse.json(
      { error: "Could not load that team." },
      { status: 502 },
    );
  }
}
