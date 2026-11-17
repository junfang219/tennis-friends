import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { onboardingDb } from "@/lib/onboarding/db";
import { reviewJoinRequestSchema } from "@/lib/onboarding/shared";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid team" }, { status: 400 });
  const db = await createSupabaseServerClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  let input;
  try { input = reviewJoinRequestSchema.parse(await request.json()); }
  catch { return NextResponse.json({ error: "Invalid request review" }, { status: 400 }); }
  const { data, error } = await onboardingDb(db).rpc("review_team_join_request", {
    p_group: id, p_request: input.requestId, p_decision: input.decision, p_player: input.playerId,
  });
  const parsed = z.object({ status: z.enum(["approved", "rejected"]) }).safeParse(data);
  return error || !parsed.success
    ? NextResponse.json({ error: "Could not review request. Refresh and check your team permissions and roster selection." }, { status: 403 })
    : NextResponse.json(parsed.data, { headers: { "Cache-Control": "no-store" } });
}
