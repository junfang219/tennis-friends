import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { onboardingDb } from "@/lib/onboarding/db";
import { createTeamSchema } from "@/lib/onboarding/management";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid team" }, { status: 400 });
  const db = await createSupabaseServerClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  let input;
  try { input = createTeamSchema.parse(await req.json()); }
  catch { return NextResponse.json({ error: "Enter a team name and a description of at most 2000 characters" }, { status: 400 }); }
  const { data: existing } = await db.from("groups").select("id,owner_id").eq("id", id).maybeSingle();
  // Retrying a completed creation must never replace that team's current roster.
  if (existing) return existing.owner_id === auth.user.id ? NextResponse.json({ groupId: id }) : NextResponse.json({ error: "Cannot create this team" }, { status: 403 });
  const { error } = await onboardingDb(db).rpc("save_team_onboarding", { p_group: id, p_config: { ...input, includeUsta: false, teamNumber: "", deadline: "" }, p_players: [] });
  if (error) return NextResponse.json({ error: "Could not create the team. Please try again." }, { status: 400 });
  // Prepare the default sharing option once. A retry must not reactivate or
  // replace a captain's existing link; completed creations return above.
  await onboardingDb(db).rpc("manage_team_join_link", { p_group: id, p_action: "enable" });
  return NextResponse.json({ groupId: id });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid team" }, { status: 400 });
  const db = await createSupabaseServerClient();
  // The RPC checks current manager access. Verified claims identify the
  // caller without a separate user lookup when a signing key is cached.
  const { data: auth } = await db.auth.getClaims();
  if (!auth?.claims.sub) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  let input;
  try { input = createTeamSchema.parse(await req.json()); }
  catch { return NextResponse.json({ error: "Enter a team name and a description of at most 2000 characters" }, { status: 400 }); }
  const { error } = await onboardingDb(db).rpc("update_team_setup_details", { p_group: id, p_name: input.name, p_description: input.description });
  return error ? NextResponse.json({ error: "Could not save team details. Team manager access is required." }, { status: error.code === "42501" ? 403 : 400 }) : NextResponse.json({ groupId: id });
}
