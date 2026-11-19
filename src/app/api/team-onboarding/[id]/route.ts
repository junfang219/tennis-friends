import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readTeamManagement, TeamManagementReadError } from "@/lib/onboarding/management-data";
import { teamManagementMutationSchema } from "@/lib/onboarding/management";
import { onboardingDb } from "@/lib/onboarding/db";
import { saveOnboardingSchema } from "@/lib/onboarding/contracts";
import type { Json } from "@/lib/database.types";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid team" }, { status: 400 });
  const db = await createSupabaseServerClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  try {
    const state = await readTeamManagement(db, id);
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof TeamManagementReadError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
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
  const rpc = input.action === "sms-recipients" || (input.action === "recipient" && input.phone !== undefined) ? "patch_team_sms_invitations" : "patch_team_onboarding";
  const { error } = await onboardingDb(db).rpc(rpc, { p_group: id, p_change: input as Json });
  if (error) {
    const message = error.code === "42501" ? "Team manager access required"
      : error.code === "23505" ? "This contact is already on the team. Use its existing entry in Pending invitations."
      : error.message?.includes("pending SMS") || error.message?.includes("pending delivery") ? "This invitation has an unresolved delivery. Review it before changing the recipient or trying again."
      : error.message?.includes("already issued") || error.message?.includes("Revoke the sent") ? "An invitation has already been issued to this contact. Use the existing invitation to resend, or revoke it before changing the recipient."
      : error.message?.includes("already joined") || error.message?.includes("unjoined player") ? "This player has already joined the team."
      : "Could not save these changes. Reload the team and check the recipient details.";
    return NextResponse.json({ error: message }, { status: error.code === "42501" ? 403 : 400 });
  }
  return NextResponse.json({ ok: true });
}
