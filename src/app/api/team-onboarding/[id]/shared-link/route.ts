import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { onboardingDb } from "@/lib/onboarding/db";
import { teamLinkActionSchema, teamLinkStateSchema } from "@/lib/onboarding/shared";

type Context = { params: Promise<{ id: string }> };
async function manage(id: string, action: string) {
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid team" }, { status: 400 });
  const db = await createSupabaseServerClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const { data, error } = await onboardingDb(db).rpc("manage_team_join_link", { p_group: id, p_action: action });
  if (error) return NextResponse.json({ error: "Could not manage team link. Team manager access and the shared-link migration are required." }, { status: 403 });
  const parsed = teamLinkStateSchema.safeParse(data);
  if (!parsed.success) return NextResponse.json({ error: "Could not load team link" }, { status: 500 });
  return NextResponse.json(parsed.data, { headers: { "Cache-Control": "no-store" } });
}
export async function GET(_request: Request, ctx: Context) { return manage((await ctx.params).id, "read"); }
export async function POST(request: Request, ctx: Context) {
  let input;
  try { input = teamLinkActionSchema.parse(await request.json()); }
  catch { return NextResponse.json({ error: "Invalid link action" }, { status: 400 }); }
  return manage((await ctx.params).id, input.action);
}
