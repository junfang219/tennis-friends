import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  searchTennisRecordTeams,
  TennisRecordFetchError,
} from "@/lib/tennisrecord/fetch";
import {
  isValidYear,
  isValidSection,
  isValidLeagueType,
} from "@/lib/tennisrecord/searchOptions";

// POST /api/groups/[id]/scouting/search
//
// "Find your team" on tennisrecord by name + optional year/section/league-type
// filters. No DB writes — just a server-side search (CORS + browser-UA must run
// server-side); requires auth, like the sibling scouting routes. Returns the
// candidate teams so the captain can pick the exact one before importing.
//
// Body: { teamName, year?, section?, leagueType? }
// 200:  { results: TeamSearchResult[] }

const Body = z.object({
  teamName: z.string().trim().min(1, "Enter a team name.").max(200),
  year: z.string().trim().refine(isValidYear, "Bad year").optional(),
  section: z.string().trim().refine(isValidSection, "Bad section").optional(),
  leagueType: z
    .string()
    .trim()
    .refine(isValidLeagueType, "Bad league type")
    .optional(),
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
    const results = await searchTennisRecordTeams(parsed);
    return NextResponse.json({ results }, { status: 200 });
  } catch (err) {
    if (err instanceof TennisRecordFetchError) {
      const code = err.status ? 502 : 400;
      return NextResponse.json({ error: err.message }, { status: code });
    }
    return NextResponse.json(
      { error: "Could not search tennisrecord." },
      { status: 502 },
    );
  }
}
