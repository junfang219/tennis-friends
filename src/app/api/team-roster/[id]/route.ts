import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { onboardingDb } from "@/lib/onboarding/db";
const changeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("member"), memberId: z.uuid(), roles: z.array(z.enum(["manager", "captain"])).max(2).optional(), memberType: z.string().max(32).optional() }).refine(v => v.roles !== undefined || v.memberType !== undefined),
  z.object({ action: z.literal("remove"), memberId: z.uuid() }),
  z.object({ action: z.literal("transfer-owner"), memberId: z.uuid() }),
]);
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid team" }, { status: 400 });
  const db = await createSupabaseServerClient(); const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  let input;
  try { input = changeSchema.parse(await req.json()); } catch { return NextResponse.json({ error: "Invalid roster change" }, { status: 400 }); }
  const { data: allowed } = await db.rpc("can_admin_group", { g: id });
  if (!allowed) return NextResponse.json({ error: "Team manager access required" }, { status: 403 });
  const [{ data: group }, { data: member }] = await Promise.all([
    db.from("groups").select("owner_id").eq("id", id).single(),
    db.from("group_members").select("id,user_id,roles").eq("group_id", id).eq("id", input.memberId).single(),
  ]);
  if (!group || !member) return NextResponse.json({ error: "Roster entry not found" }, { status: 404 });
  if (input.action === "remove") {
    if (member.user_id === group.owner_id || member.user_id === auth.user.id) return NextResponse.json({ error: "This roster entry cannot be removed here" }, { status: 403 });
    const { error } = await onboardingDb(db).rpc("patch_team_onboarding", { p_group: id, p_change: { action: "remove-member", memberId: member.id } });
    return error ? NextResponse.json({ error: "Could not remove player" }, { status: 400 }) : NextResponse.json({ ok: true });
  }
  if (input.action === "transfer-owner") {
    if (group.owner_id !== auth.user.id || !member.user_id) return NextResponse.json({ error: "Only the owner can transfer ownership to a team member" }, { status: 403 });
    const { error } = await db.rpc("transfer_group_ownership", { p_group_id: id, p_new_owner_id: member.user_id });
    return error ? NextResponse.json({ error: "Could not transfer ownership" }, { status: 400 }) : NextResponse.json({ ok: true });
  }
  if (input.roles && group.owner_id !== auth.user.id && input.roles.includes("manager") !== member.roles.includes("manager")) return NextResponse.json({ error: "Only the owner can change manager access" }, { status: 403 });
  const patch = { ...(input.roles ? { roles: input.roles } : {}), ...(input.memberType !== undefined ? { member_type: input.memberType } : {}) };
  const { error } = await db.from("group_members").update(patch).eq("group_id", id).eq("id", member.id);
  return error ? NextResponse.json({ error: "Could not save roster change" }, { status: 400 }) : NextResponse.json({ ok: true });
}
