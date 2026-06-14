import { Resend } from "resend";

import { errorMessage } from "./errorMessage";

const ALERT_FROM = "TennisFriend <reminders@mytennisfriends.com>";

export type CourtAlertEmailOptions = {
  to: string;
  venueName: string;
  whenLabel: string; // "Sat, Jun 20"
  spanLabel: string; // "5–8pm" — the open span within the requested window
  bookUrl: string; // deep link to the court detail page on that date
};

/**
 * Send a single "court is open" alert email via Resend. Best-effort — the
 * caller never blocks on the result. No-op + warn when RESEND_API_KEY unset.
 * Mirrors src/lib/reminderEmail.ts.
 */
export async function sendCourtAlertEmail(
  opts: CourtAlertEmailOptions
): Promise<string | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[court-alert-email] RESEND_API_KEY not set — skipping send.");
    return null;
  }

  const text = [
    `A court just opened up at ${opts.venueName}.`,
    "",
    `When: ${opts.whenLabel}`,
    `Open: ${opts.spanLabel}`,
    "",
    "Courts go fast — book it now:",
    opts.bookUrl,
    "",
    "— TennisFriend",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1f2937;">
      <p style="font-size: 13px; color: #6b7280; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700;">
        Court available
      </p>
      <h2 style="font-size: 18px; margin: 0 0 12px;">${escapeHtml(opts.venueName)}</h2>
      <p style="font-size: 14px; line-height: 1.6; margin: 0 0 6px;"><strong>When:</strong> ${escapeHtml(opts.whenLabel)}</p>
      <p style="font-size: 14px; line-height: 1.6; margin: 0 0 16px;"><strong>Open:</strong> ${escapeHtml(opts.spanLabel)}</p>
      <p style="font-size: 13px; color: #4b5563; margin: 0 0 16px;">Courts go fast — grab it before it's gone.</p>
      <p style="margin: 0;">
        <a href="${opts.bookUrl}" style="display: inline-block; background: #2f7d4f; color: white; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
          Book now
        </a>
      </p>
    </div>
  `;

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: ALERT_FROM,
      to: opts.to,
      subject: `${opts.venueName}: a court just opened (${opts.whenLabel})`,
      text,
      html,
    });
    if (error) {
      console.error("[court-alert-email] resend error:", error);
      return error.message ?? "Resend rejected the message.";
    }
    return null;
  } catch (err) {
    console.error("[court-alert-email] resend threw:", err);
    return errorMessage(err, "Send failed.");
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
