import { Resend } from "resend";

const INVITE_FROM = "TennisFriend <invites@mytennisfriends.com>";

export type InviteEmailOptions = {
  to: string;
  inviterName: string;
  teamName: string;
  acceptUrl: string;
  expiresAt: Date;
};

/**
 * Sends a team invite email via Resend. Returns null on success or a
 * short error string on failure. Caller decides whether to surface the
 * error or let the invite row stand (user can re-send later).
 *
 * No-ops with a logged warning when RESEND_API_KEY is unset — useful in
 * local dev where you can still inspect the invite row in Prisma Studio.
 */
export async function sendInviteEmail(opts: InviteEmailOptions): Promise<string | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[invite-email] RESEND_API_KEY not set — skipping email send.");
    return null;
  }

  const dateLabel = opts.expiresAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const text = [
    `Hi,`,
    ``,
    `${opts.inviterName} invited you to join the team "${opts.teamName}" on TennisFriend.`,
    ``,
    `Accept the invite:`,
    opts.acceptUrl,
    ``,
    `This invite expires on ${dateLabel}.`,
    ``,
    `— TennisFriend`,
  ].join("\n");

  // Plain HTML; intentionally minimal — Resend renders it safely.
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1f2937;">
      <h2 style="font-size: 18px; margin: 0 0 12px;">You're invited to a tennis team</h2>
      <p style="font-size: 14px; line-height: 1.5; margin: 0 0 16px;">
        <strong>${escapeHtml(opts.inviterName)}</strong> invited you to join
        <strong>${escapeHtml(opts.teamName)}</strong> on TennisFriend.
      </p>
      <p style="margin: 0 0 24px;">
        <a href="${opts.acceptUrl}" style="display: inline-block; background: #2f7d4f; color: white; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
          Accept invite
        </a>
      </p>
      <p style="font-size: 12px; color: #6b7280; margin: 0;">
        This invite expires on ${dateLabel}. If the button doesn't work, paste this link into your browser:<br/>
        <span style="word-break: break-all;">${opts.acceptUrl}</span>
      </p>
    </div>
  `;

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: INVITE_FROM,
      to: opts.to,
      subject: `${opts.inviterName} invited you to ${opts.teamName} on TennisFriend`,
      text,
      html,
    });
    if (error) {
      console.error("[invite-email] resend error:", error);
      return error.message ?? "Resend rejected the message.";
    }
    return null;
  } catch (err) {
    console.error("[invite-email] resend threw:", err);
    return err instanceof Error ? err.message : "Send failed.";
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
