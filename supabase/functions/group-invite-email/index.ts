// Supabase Edge Function: group-invite-email
//
// Sends a team-invite email via Resend when a row lands in
// public.group_invites. Invoked by the `group_invites_send_email`
// AFTER INSERT trigger through public.invoke_edge_function().
//
// Replaces the legacy /api/groups/[id]/invites route that called
// sendInviteEmail() from src/lib/inviteEmail.ts (both deleted in
// commit 86f26a5). The trigger fires asynchronously via pg_net, so a
// transient email failure can't roll back the invite write — the
// invite row stands and the organizer can re-send manually.
//
// Env vars (configure in Supabase dashboard → Edge Functions → Secrets):
//   RESEND_API_KEY        Required. Function no-ops with a log warning
//                         when unset, mirroring the legacy helper.
//   APP_URL               Optional. Base URL used to build the accept
//                         link. Defaults to https://mytennisfriends.com.
//   INVITE_FROM           Optional. Defaults to
//                         "TennisFriend <invites@mytennisfriends.com>".
//
// Request body (JSON, posted by the DB trigger):
//   {
//     "to":           "email@example.com",
//     "inviter_name": "Alice",
//     "team_name":    "Saturday Doubles",
//     "token":        "<uuid or random token>",
//     "expires_at":   "2026-06-30T00:00:00Z"
//   }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireTriggerSecret } from "../_shared/trigger_auth.ts";

interface InvitePayload {
  to?: string;
  inviter_name?: string;
  team_name?: string;
  token?: string;
  expires_at?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

Deno.serve(async (req: Request) => {
  // Anon-key + verify_jwt is not enough — the anon key ships in
  // every client bundle. Layer a shared secret attached by the DB
  // trigger so anyone with the anon key can't use this function as
  // a free outbound-email relay.
  const unauthorized = requireTriggerSecret(req);
  if (unauthorized) return unauthorized;

  let payload: InvitePayload;
  try {
    payload = (await req.json()) as InvitePayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const to = (payload.to ?? "").trim();
  const inviterName = (payload.inviter_name ?? "").trim() || "A teammate";
  const teamName = (payload.team_name ?? "").trim() || "a tennis team";
  const token = (payload.token ?? "").trim();
  const expiresAtRaw = (payload.expires_at ?? "").trim();

  if (!to || !token) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing to or token" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("[group-invite-email] RESEND_API_KEY unset — skipping send");
    return Response.json({ ok: true, skipped: "no_resend_key" });
  }

  const appUrl = (Deno.env.get("APP_URL") ?? "https://mytennisfriends.com").replace(/\/+$/, "");
  const from = Deno.env.get("INVITE_FROM") ?? "TennisFriend <invites@mytennisfriends.com>";
  const acceptUrl = `${appUrl}/invite/${encodeURIComponent(token)}`;

  const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
  const dateLabel =
    expiresAt && !isNaN(expiresAt.getTime())
      ? expiresAt.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "soon";

  const text = [
    `Hi,`,
    ``,
    `${inviterName} invited you to join the team "${teamName}" on TennisFriend.`,
    ``,
    `Accept the invite:`,
    acceptUrl,
    ``,
    `This invite expires on ${dateLabel}.`,
    ``,
    `— TennisFriend`,
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1f2937;">
      <h2 style="font-size: 18px; margin: 0 0 12px;">You're invited to a tennis team</h2>
      <p style="font-size: 14px; line-height: 1.5; margin: 0 0 16px;">
        <strong>${escapeHtml(inviterName)}</strong> invited you to join
        <strong>${escapeHtml(teamName)}</strong> on TennisFriend.
      </p>
      <p style="margin: 0 0 24px;">
        <a href="${acceptUrl}" style="display: inline-block; background: #2f7d4f; color: white; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
          Accept invite
        </a>
      </p>
      <p style="font-size: 12px; color: #6b7280; margin: 0;">
        This invite expires on ${dateLabel}. If the button doesn't work, paste this link into your browser:<br/>
        <span style="word-break: break-all;">${escapeHtml(acceptUrl)}</span>
      </p>
    </div>
  `;

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: `${inviterName} invited you to ${teamName} on TennisFriend`,
        text,
        html,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error(`[group-invite-email] resend ${resp.status}: ${errText}`);
      return Response.json(
        { ok: false, status: resp.status, error: errText },
        { status: 502 }
      );
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[group-invite-email] fetch threw:", err);
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
});
