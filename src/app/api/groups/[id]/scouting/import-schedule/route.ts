import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { planScheduleImport } from "@/lib/tennisrecord/importPlan";

// POST /api/groups/[id]/scouting/import-schedule
//
// Imports league-schedule rows (from a league scout) into team_matches.
// Captain-confirmed in the UI and insert-only: existing matches — whether
// previously imported or captain-entered — are never updated, so a re-import
// is harmlessly idempotent. Captain-only via team_matches RLS (42501 → 403).
//
// Body: { matches: [{ dateISO, time, opponentName, opponentHref }] }
// 200:  { imported, skipped }

const Body = z.object({
  matches: z
    .array(
      z.object({
        dateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Bad date"),
        time: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .nullable()
          .optional(),
        opponentName: z.string().trim().min(1).max(200),
        opponentHref: z.string().trim().max(2000).optional(),
        matchSite: z.string().trim().max(200).optional(),
      }),
    )
    .min(1)
    .max(50),
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

  // Resolve scouted opponent rows for the FK links (one query for the batch).
  const { data: scouted, error: scoutedErr } = await supabase
    .from("opponent_teams")
    .select("id, source_team_key")
    .eq("group_id", groupId);
  if (scoutedErr) {
    return NextResponse.json({ error: scoutedErr.message }, { status: 400 });
  }
  const teamIdByKey = new Map(
    (scouted ?? []).map((t) => [t.source_team_key, t.id] as const),
  );

  const { data: existing, error: existingErr } = await supabase
    .from("team_matches")
    .select("match_date, opponent, opponent_team_id")
    .eq("group_id", groupId);
  if (existingErr) {
    return NextResponse.json({ error: existingErr.message }, { status: 400 });
  }

  const { rows, skipped } = planScheduleImport(
    parsed.matches,
    existing ?? [],
    teamIdByKey,
  );

  if (rows.length > 0) {
    const { error: insErr } = await supabase
      .from("team_matches")
      .insert(rows.map((r) => ({ ...r, group_id: groupId })));
    if (insErr) {
      const status = insErr.code === "42501" ? 403 : 400;
      return NextResponse.json({ error: insErr.message }, { status });
    }
  }

  return NextResponse.json(
    { imported: rows.length, skipped },
    { status: 200 },
  );
}
