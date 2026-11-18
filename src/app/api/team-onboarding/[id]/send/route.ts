import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { onboardingDb } from "@/lib/onboarding/db";
import { storedOnboardingSchema } from "@/lib/onboarding/contracts";
import { deliveryRecipientVersionSchema, invitationOptionsSchema } from "@/lib/onboarding/management";
import { invitationIssues, registrationMessage } from "@/lib/registrationOnboarding";
import { invitationPhoneSchema } from "@/lib/onboarding/phone";
import { deliver, deliveryConfig, smsConfiguration, smsText, DeliveryError } from "@/lib/onboarding/delivery";

export const maxDuration = 300;
const requestSchema = z.object({ batchId: z.uuid(), reminder: z.boolean().default(false), mode: z.enum(["prepare", "email", "sms"]).default("prepare"), smsConsent: z.boolean().optional(), playerIds: z.array(z.uuid()).min(1).max(100).optional(), invitation: invitationOptionsSchema.optional(), recipients: z.array(deliveryRecipientVersionSchema).min(1).max(100).optional() });
const claimSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("claimed"), deliveryId: z.uuid(), settings: storedOnboardingSchema.shape.config, recipient: z.object({ id: z.uuid(), name: z.string(), token: z.string().regex(/^[a-f0-9]{64}$/), address: z.string() }) }),
  z.object({ status: z.enum(["sent", "sending", "failed", "changed", "unavailable", "skipped"]) }),
]);
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = await createSupabaseServerClient(); const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  let body;
  try { body = requestSchema.parse(await req.json()); z.uuid().parse(id); }
  catch { return NextResponse.json({ error: "Invalid send request" }, { status: 400 }); }
  if (body.mode === "sms" && (body.reminder || body.smsConsent !== true)) return NextResponse.json({ error: body.reminder ? "SMS reminders are not enabled; use email or share a reminder" : "Confirm these players agreed to receive this invitation by SMS" }, { status: 400 });
  if (body.reminder && body.invitation) return NextResponse.json({ error: "Invitation options cannot override a registration reminder" }, { status: 400 });
  if (body.reminder) {
    const { error } = await onboardingDb(db).rpc("patch_team_onboarding", { p_group: id, p_change: { action: "init" } });
    if (error) return NextResponse.json({ error: "Could not prepare the current team roster" }, { status: 403 });
  }
  const { data, error } = await onboardingDb(db).rpc("read_team_onboarding", { p_group: id });
  if (error) return NextResponse.json({ error: "Team manager access required" }, { status: 403 });
  const saved = storedOnboardingSchema.safeParse(data);
  if (!saved.success) return NextResponse.json({ error: "Save your team first" }, { status: 400 });
  const { config: stored, players } = saved.data;
  // This is preflight only. The claim RPC supplies the immutable batch settings
  // used below; another captain's preference cannot replace this request's choice.
  const settings = body.invitation ? { ...stored, invitationMessage: body.invitation.message, includeUsta: body.invitation.includeUsta, ...(body.invitation.includeUsta ? body.invitation.registration : {}) } : body.reminder || stored.includeUstaInInvitations !== false ? stored : { ...stored, includeUsta: false };
  if (body.playerIds?.some(playerId => !players.some(p => p.id === playerId))) return NextResponse.json({ error: "Choose invitation recipients from this team" }, { status: 400 });
  const selected = players.filter(p => (!body.playerIds || body.playerIds.includes(p.id)) && (!body.reminder || !p.confirmed_at));
  if (body.recipients && (new Set(body.recipients.map(p => p.id)).size !== body.recipients.length || body.recipients.length !== selected.length || selected.some(p => {
    const expected = body.recipients?.find(v => v.id === p.id);
    return !expected || expected.token !== p.token || expected.phone !== p.phone || expected.email !== p.email || expected.associatedAccountId !== p.associated_account_id;
  }))) return NextResponse.json({ error: "A recipient changed. Refresh and review the invitation before sending." }, { status: 409 });
  const issues = invitationIssues({ ...settings, players: selected.map(p => ({ id: p.id, name: p.name, phone: p.phone ?? "", email: p.email ?? "", confirmedAt: p.confirmed_at, memberId: p.accepted_by, invitedAt: p.sent_at, remindedAt: null })) });
  if (issues.length || !selected.length) return NextResponse.json({ error: issues.join(" ") || "No recipients" }, { status: 400 });
  let config;
  try { config = deliveryConfig(); }
  catch { return NextResponse.json({ error: "Set ONBOARDING_PUBLIC_ORIGIN to the app's public URL before sending" }, { status: 503 }); }
  const admin = onboardingDb(createSupabaseAdminClient());
  const accountIds = selected.map(p => p.associated_account_id).filter((account): account is string => Boolean(account));
  const { data: accounts } = accountIds.length ? await admin.from("profiles").select("id,email").in("id", accountIds) : { data: [] };
  const emailByAccount = new Map((accounts ?? []).map(account => [account.id, account.email]));
  const addressOf = (p: typeof selected[number]) => body.mode === "sms" ? p.phone : p.email || (p.associated_account_id ? emailByAccount.get(p.associated_account_id) : null) || null;
  const unavailable = (p: typeof selected[number]) => p.revoked_at !== null || (Date.parse(p.expires_at) < Date.now() && !(body.reminder && p.accepted_by !== null));
  if (body.mode === "prepare") {
    const invitations = [];
    for (const player of selected) {
      if (unavailable(player)) continue;
      const link = `${config.origin.replace(/\/$/, "")}/team-invitations/${player.token}`;
      const { error } = await admin.from("team_onboarding_players").update({ sent_at: player.sent_at ?? new Date().toISOString() }).eq("id", player.id).eq("token", player.token).is("revoked_at", null).select("id").single();
      if (error) return NextResponse.json({ error: "Could not prepare invitation; refresh and try again" }, { status: 409 });
      invitations.push({ id: player.id, name: player.name, phone: player.phone, link, message: registrationMessage({ ...settings, players: [] }, link, body.reminder) });
    }
    return NextResponse.json({ invitations });
  }
  if (body.mode === "sms") {
    if (new URL(config.origin).protocol !== "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(new URL(config.origin).hostname)) return NextResponse.json({ error: "SMS invitations need a public HTTPS invitation URL. Configure ONBOARDING_PUBLIC_ORIGIN or use a preview deployment." }, { status: 503 });
    if (!smsConfiguration(config).success) return NextResponse.json({ error: "SMS delivery is not configured. Contact the team administrator, or use email or the shared team link." }, { status: 503 });
    if (selected.some(p => !invitationPhoneSchema.safeParse(p.phone).success)) return NextResponse.json({ error: "Each selected player needs a valid phone number" }, { status: 400 });
    if (selected.some(p => p.accepted_by !== null)) return NextResponse.json({ error: "Choose players who have not already joined" }, { status: 400 });
    if (selected.some(p => smsText(registrationMessage({ ...settings, players: [] }, `${config.origin.replace(/\/$/, "")}/team-invitations/${p.token}`, false)).length > 1600)) return NextResponse.json({ error: "SMS is too long. Shorten the invitation message or team description, or use email." }, { status: 400 });
  } else {
    if (!selected.some(p => addressOf(p))) return NextResponse.json({ error: "No email addresses available. Add email recipients in Invite players, or use the shared team link." }, { status: 400 });
    if (!config.emailKey || !config.emailFrom) return NextResponse.json({ error: "Email delivery is not configured" }, { status: 503 });
  }
  const { count, error: limitError } = await admin.from("team_onboarding_deliveries").select("id", { count: "exact", head: true }).in("player_id", players.map(p => p.id)).gte("created_at", new Date(Date.now() - 3600000).toISOString());
  if (limitError) return NextResponse.json({ error: "Could not check delivery limits. Please try again." }, { status: 503 });
  if ((count ?? 0) + selected.length > (body.mode === "sms" ? 100 : 500)) return NextResponse.json({ error: "Too many invitations recently; try later" }, { status: 429 });
  let sent = 0, failed = 0, pending = 0, changed = false;
  for (const player of selected) {
    if (unavailable(player)) { failed++; continue; }
    if (!addressOf(player)) continue;
    const { data, error } = await onboardingDb(db).rpc("claim_team_onboarding_delivery", {
      p_group: id, p_player: player.id, p_batch: body.batchId, p_channel: body.mode, p_reminder: body.reminder,
      p_expected: { token: player.token, phone: player.phone, email: player.email, associatedAccountId: player.associated_account_id, address: addressOf(player) }, p_options: body.invitation ?? null,
    });
    if (error) { if (error.code === "42501") return NextResponse.json({ error: "Team manager access required" }, { status: 403 }); failed++; continue; }
    const parsed = claimSchema.safeParse(data);
    if (!parsed.success) { pending++; continue; }
    const claim = parsed.data;
    if (claim.status !== "claimed") {
      if (claim.status === "sent") sent++; else if (claim.status === "sending") pending++; else if (claim.status !== "skipped") failed++;
      if (claim.status === "changed") changed = true;
      continue;
    }
    const { recipient } = claim;
    const address = body.mode === "sms" ? invitationPhoneSchema.safeParse(recipient.address) : z.email().safeParse(recipient.address);
    const link = `${config.origin.replace(/\/$/, "")}/team-invitations/${recipient.token}`;
    const message = registrationMessage({ ...claim.settings, players: [] }, link, body.reminder);
    if (!address.success || (body.mode === "sms" && smsText(message).length > 1600)) {
      const { error } = await admin.from("team_onboarding_deliveries").update({ status: "failed" }).eq("id", claim.deliveryId);
      if (error) pending++; else failed++;
      continue;
    }
    try {
      const providerId = await deliver(body.mode, address.data, message, `Invitation to ${claim.settings.name}`, claim.deliveryId, config);
      const { error } = await admin.from("team_onboarding_deliveries").update({ status: "sent", provider_id: providerId }).eq("id", claim.deliveryId);
      if (error) { pending++; continue; }
      const { error: issueError } = await admin.from("team_onboarding_players").update({ sent_at: new Date().toISOString() }).eq("id", recipient.id).eq("token", recipient.token).is("revoked_at", null).select("id").single();
      if (issueError) { pending++; continue; }
      sent++;
    } catch (error) {
      if (body.mode === "sms" && (!(error instanceof DeliveryError) || error.outcome === "unknown")) { pending++; continue; }
      const { error: updateError } = await admin.from("team_onboarding_deliveries").update({ status: "failed" }).eq("id", claim.deliveryId);
      if (updateError) pending++; else failed++;
    }
  }
  return NextResponse.json({ sent, failed, pending, message: changed ? "A recipient changed. Refresh and review the invitation before sending again." : failed || pending ? "Some deliveries failed or have an unknown outcome. Review before starting another batch. Pending SMS must be reconciled with the provider before retrying." : "Invitations accepted by the delivery provider. This does not guarantee handset or inbox delivery." });
}
