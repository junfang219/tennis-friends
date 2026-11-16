import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listOnboardingFriends } from "@/lib/onboarding/friends";
import { onboardingDb } from "@/lib/onboarding/db";
import { saveOnboardingSchema, storedOnboardingSchema } from "@/lib/onboarding/contracts";
import type { Json } from "@/lib/database.types";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid team" }, { status: 400 });
  const db = await createSupabaseServerClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const { data, error } = await onboardingDb(db).rpc("read_team_onboarding", { p_group: id });
  if (error) return NextResponse.json({ error: "Cannot load onboarding. Confirm the database migration is installed and you manage this team." }, { status: 403 });
  const parsed = storedOnboardingSchema.safeParse(data);
  if (!parsed.success) return NextResponse.json({ error: "Team onboarding is not configured" }, { status: 404 });
  const friends = await listOnboardingFriends(db, auth.user.id);
  return NextResponse.json({ ...parsed.data, friends: friends.map(f => ({ id: f.id, name: f.name })) }, { headers: { "Cache-Control": "no-store" } });
}
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid team" }, { status: 400 });
  const db = await createSupabaseServerClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  let input;
  try { input = saveOnboardingSchema.parse(await req.json()); } catch { return NextResponse.json({ error: "Check team details and player contact information" }, { status: 400 }); }
  const { data, error } = await onboardingDb(db).rpc("save_team_onboarding", { p_group: id, p_config: input.draft as Json, p_players: input.players as Json });
  if (error) return NextResponse.json({ error: error.code === "42501" ? "You cannot manage this team or associate that account" : "Could not save team. Check duplicate contacts and database setup." }, { status: 400 });
  return NextResponse.json(data);
}
