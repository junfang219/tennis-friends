import { expect, type BrowserContext } from "@playwright/test";
import { z } from "zod";
import { createTeamSchema, teamManagementMutationSchema, type TeamManagementState } from "../../src/lib/onboarding/management";
import { reviewJoinRequestSchema, teamLinkActionSchema, teamLinkStateSchema } from "../../src/lib/onboarding/shared";
import type { storedPlayerSchema } from "../../src/lib/onboarding/contracts";
export const groupId = "33333333-3333-4333-8333-333333333333";
export const userId = "55555555-5555-4555-8555-555555555555";
export const playerId = "66666666-6666-4666-8666-666666666666";
export const requestId = "44444444-4444-4444-8444-444444444444";
export const token = "a".repeat(64);
export function player(id = playerId, overrides: Partial<z.infer<typeof storedPlayerSchema>> = {}): z.infer<typeof storedPlayerSchema> {
  return { id, group_id: groupId, member_id: id, name: "Invited Player", phone: null, email: "player@example.com", associated_account_id: null, associated_account_name: null, accepted_by: null, confirmed_at: null, sent_at: "2026-11-17T00:00:00Z", accepted_at: null, token: "c".repeat(64), expires_at: "2099-12-31T00:00:00Z", revoked_at: null, ...overrides };
}
export async function managementFixture(context: BrowserContext, initialPlayers: z.infer<typeof storedPlayerSchema>[] = []) {
  const state: TeamManagementState = { config: { name: "Shared review", description: "Saved description", includeUsta: false, teamNumber: "", deadline: "" }, players: initialPlayers, members: [], legacyInvitations: [] };
  const shared: z.infer<typeof teamLinkStateSchema> = { token: null, enabled: false, requests: [] };
  const controls = { denyApproval: false, status: "ready", emailFailed: 0, emailPending: 0, smsPending: 0, smsFailed: 0, smsConfigured: true };
  const writes: Array<{ path: string; method: string; body: unknown }> = [];
  await context.route("**/api/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method())) writes.push({ path, method: req.method(), body: req.postDataJSON() });
    if (path.includes("/team-join/")) {
      if (!shared.enabled || !path.endsWith(shared.token ?? "missing")) return route.fulfill({ status: 404, json: { error: "Unavailable" } });
      if (req.method() === "POST" && controls.status === "ready") { controls.status = "pending"; shared.requests.push({ id: requestId, userId, name: "New Player", email: "new@example.com", createdAt: "2026-11-17T00:00:00Z" }); }
      return route.fulfill({ json: { groupId, name: state.config.name, description: state.config.description ?? "", status: controls.status } });
    }
    if (path.endsWith("/shared-link")) {
      if (req.method() === "POST") { const { action } = teamLinkActionSchema.parse(req.postDataJSON()); if (action === "enable") { shared.token ??= token; shared.enabled = true; } if (action === "replace") { shared.token = "b".repeat(64); shared.enabled = true; } if (action === "disable") shared.enabled = false; }
      return route.fulfill({ json: shared });
    }
    if (path.endsWith("/join-requests")) {
      if (controls.denyApproval) return route.fulfill({ status: 403, json: { error: "Approval denied" } });
      const input = reviewJoinRequestSchema.parse(req.postDataJSON()); expect(input.requestId).toBe(requestId); shared.requests = []; controls.status = input.decision === "approve" ? "joined" : "rejected";
      if (input.decision === "approve") {
        const match = state.players.find(p => p.id === input.playerId);
        if (match) Object.assign(match, { accepted_by: userId, associated_account_id: userId, accepted_at: "2026-11-17T00:00:00Z" });
        else state.players.push(player(playerId, { name: "New Player", email: null, accepted_by: userId, associated_account_id: userId, sent_at: null, accepted_at: "2026-11-17T00:00:00Z" }));
        state.members.push({ id: playerId, userId, name: "New Player" });
      }
      return route.fulfill({ json: { status: input.decision === "approve" ? "approved" : "rejected" } });
    }
    if (path.endsWith("/create")) { const input = createTeamSchema.parse(req.postDataJSON()); state.config = { ...state.config, ...input }; if (req.method() === "POST") { shared.token ??= token; shared.enabled = true; } return route.fulfill({ json: { groupId } }); }
    if (path.endsWith("/revoke")) {
      const { playerId: id, renew } = z.object({ playerId: z.uuid(), renew: z.boolean().optional() }).parse(req.postDataJSON());
      state.players = state.players.map(p => p.id !== id ? p : renew ? { ...p, sent_at: null, revoked_at: null, token: "d".repeat(64) } : { ...p, revoked_at: "2026-11-17T01:00:00Z" });
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith("/send")) {
      const body = z.object({ mode: z.enum(["prepare", "email", "sms"]), reminder: z.boolean(), playerIds: z.array(z.uuid()).optional() }).parse(req.postDataJSON());
      if (body.mode === "sms" && !controls.smsConfigured) return route.fulfill({ status: 503, json: { error: "SMS delivery is not configured. Use email or the shared team link." } });
      const selected = state.players.filter(p => (!body.playerIds || body.playerIds.includes(p.id)) && (!body.reminder || !p.confirmed_at) && !p.revoked_at);
      if (body.mode === "prepare") return route.fulfill({ json: { invitations: selected.map(p => ({ id: p.id, name: p.name, message: `Reminder: ${p.name} · ${state.config.teamNumber}` })) } });
      for (const p of selected) p.sent_at = "2026-11-17T02:00:00Z";
      const failed = body.mode === "sms" ? controls.smsFailed : controls.emailFailed, pending = body.mode === "sms" ? controls.smsPending : controls.emailPending;
      return route.fulfill({ json: { sent: Math.max(0, selected.length - failed - pending), failed, pending, message: "Test provider report" } });
    }
    if (path === `/api/team-onboarding/${groupId}`) {
      if (req.method() === "PUT") throw new Error("Full-roster writes are forbidden in the new flow");
      if (req.method() === "PATCH") {
        const input = teamManagementMutationSchema.parse(req.postDataJSON());
        if (input.action === "sms-recipients") { for (const r of input.recipients) if (!state.players.some(p => p.id === r.id)) state.players.push(player(r.id, { name: r.name, phone: r.phone, email: null, sent_at: null })); }
        if (input.action === "recipients") { for (const r of input.recipients) if (!state.players.some(p => p.id === r.id)) state.players.push(player(r.id, { name: r.name, email: r.email, sent_at: null })); }
        if (input.action === "message") { state.config.invitationMessage = input.message; state.config.includeUstaInInvitations = input.includeUstaInInvitations; }
        if (input.action === "registration") { const { action: _action, ...config } = input; void _action; state.config = { ...state.config, ...config }; }
        if (input.action === "confirmation") { let p = state.players.find(p => p.id === input.playerId); if (!p) { const m = state.members.find(m => m.id === input.playerId); if (m) { p = player(m.id, { name: m.name, accepted_by: m.userId, sent_at: null }); state.players.push(p); } } if (p) p.confirmed_at = input.confirmed ? "2026-11-17T00:00:00Z" : null; }
        if (input.action === "recipient") { const p = state.players.find(p => p.id === input.playerId); if (p) { const changed = p.email !== input.email || p.associated_account_id !== input.associatedAccountId || (input.phone !== undefined && p.phone !== input.phone); Object.assign(p, { name: input.name, email: input.email, associated_account_id: input.associatedAccountId, ...(input.phone !== undefined ? {phone: input.phone} : {}) }); if (p.revoked_at && changed) { p.sent_at = null; p.token = "e".repeat(64); } } }
        if (input.action === "cancel-legacy") state.legacyInvitations = state.legacyInvitations.filter(i => i.id !== input.inviteId);
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({ json: state });
    }
    return route.fulfill({ status: 404, json: { error: "No live APIs in this fixture" } });
  });
  return { state, shared, controls, writes };
}
