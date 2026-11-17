import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listGroupMembers } from "@/lib/supabase/queries/groups";
import { teamManagementMutationSchema, teamManagementStateSchema } from "@/lib/onboarding/management";
import { onboardingDb } from "@/lib/onboarding/db";
import { saveOnboardingSchema } from "@/lib/onboarding/contracts";
import type { Json } from "@/lib/database.types";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid team" }, { status: 400 });
  const db = await createSupabaseServerClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const { data, error } = await onboardingDb(db).rpc("read_team_onboarding", { p_group: id });
  if (error) return NextResponse.json({ error: "Cannot load onboarding. Confirm the database migration is installed and you manage this team." }, { status: 403 });
  const [group, members, legacy] = await Promise.all([
    db.from("groups").select("name").eq("id", id).single(),
    listGroupMembers(db, id),
    db.from("group_invites").select("id,email,token,roles,member_type").eq("group_id", id).eq("status", "pending").gt("expires_at", new Date().toISOString()),
  ]);
  if (!group.data) return NextResponse.json({ error: "Team not found" }, { status: 404 });
  const raw = z.object({ config: z.unknown(), players: z.array(z.unknown()) }).safeParse(data);
  if (!raw.success) return NextResponse.json({ error: "Cannot load team invitations" }, { status: 500 });
  const config = raw.data.config ?? { name: group.data.name, description: "", includeUsta: false, teamNumber: "", deadline: "" };
  const parsed = teamManagementStateSchema.safeParse({ config: { ...z.record(z.string(),z.unknown()).parse(config), name: group.data.name }, players: raw.data.players,
    members: members.map(m => ({ id: m.id, userId: m.user_id, name: m.user.name })),
    legacyInvitations: (legacy.data ?? []).map(i => ({ id: i.id, email: i.email, token: i.token, roles: i.roles, memberType: i.member_type })),
  });
  if (!parsed.success) return NextResponse.json({ error: "Cannot load team invitations" }, { status: 500 });
  return NextResponse.json(parsed.data, { headers: { "Cache-Control": "no-store" } });
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

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid team" }, { status: 400 });
  const db = await createSupabaseServerClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  let input;
  try { input = teamManagementMutationSchema.parse(await req.json()); }
  catch { return NextResponse.json({ error: "Check the invitation or registration details" }, { status: 400 }); }
  if (input.action === "cancel-legacy") {
    const { data: allowed } = await db.rpc("can_admin_group", { g: id });
    if (!allowed) return NextResponse.json({ error: "Team manager access required" }, { status: 403 });
    const { error } = await db.from("group_invites").update({ status: "cancelled" }).eq("group_id", id).eq("id", input.inviteId).eq("status", "pending");
    return error ? NextResponse.json({ error: "Could not cancel invitation" }, { status: 400 }) : NextResponse.json({ ok: true });
  }
  const { error } = await onboardingDb(db).rpc("patch_team_onboarding", { p_group: id, p_change: input as Json });
  if (error) return NextResponse.json({ error: error.code === "42501" ? "Team manager access required" : "Could not save changes. Revoke issued invitations before correcting a recipient, and check for duplicate emails." }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ ok: true });
}
