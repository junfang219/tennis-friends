import { Resend } from "resend";

const REMINDER_FROM = "TennisFriend <reminders@mytennisfriends.com>";

export type ReminderEmailOptions = {
  to: string;
  teamName: string;
  kind: "match" | "practice";
  title: string; // e.g. opponent label or practice series name
  whenLabel: string; // "Tomorrow at 6:00 PM" or "Tonight at 7:00 PM"
  location: string;
  hoursBefore: number; // 24 | 12 | 6 | 3 | 1
  rsvpUrl: string;
};

/**
 * Send a single reminder email via Resend. Best-effort — caller never
 * blocks on the result. No-op + warn when RESEND_API_KEY unset.
 */
export async function sendReminderEmail(opts: ReminderEmailOptions): Promise<string | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[reminder-email] RESEND_API_KEY not set — skipping send.");
    return null;
  }

  const kindLabel = opts.kind === "match" ? "Match" : "Practice";
  const leadLabel =
    opts.hoursBefore >= 24 ? `in about ${Math.round(opts.hoursBefore / 24)} day(s)` :
    `in about ${opts.hoursBefore} hour(s)`;

  const text = [
    `Heads up — ${opts.teamName} has a ${kindLabel.toLowerCase()} coming up ${leadLabel}.`,
    "",
    `${kindLabel}: ${opts.title}`,
    `When: ${opts.whenLabel}`,
    `Where: ${opts.location}`,
    "",
    "You haven't RSVPed yet — let your team know:",
    opts.rsvpUrl,
    "",
    "— TennisFriend",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1f2937;">
      <p style="font-size: 13px; color: #6b7280; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700;">
        ${kindLabel} reminder — ${escapeHtml(opts.teamName)}
      </p>
      <h2 style="font-size: 18px; margin: 0 0 12px;">${escapeHtml(opts.title)}</h2>
      <p style="font-size: 14px; line-height: 1.6; margin: 0 0 6px;"><strong>When:</strong> ${escapeHtml(opts.whenLabel)}</p>
      <p style="font-size: 14px; line-height: 1.6; margin: 0 0 16px;"><strong>Where:</strong> ${escapeHtml(opts.location)}</p>
      <p style="font-size: 13px; color: #4b5563; margin: 0 0 16px;">You haven't RSVPed yet — let your team know whether you're in.</p>
      <p style="margin: 0;">
        <a href="${opts.rsvpUrl}" style="display: inline-block; background: #2f7d4f; color: white; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
          RSVP now
        </a>
      </p>
    </div>
  `;

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: REMINDER_FROM,
      to: opts.to,
      subject: `${opts.teamName}: ${kindLabel} ${leadLabel}`,
      text,
      html,
    });
    if (error) {
      console.error("[reminder-email] resend error:", error);
      return error.message ?? "Resend rejected the message.";
    }
    return null;
  } catch (err) {
    console.error("[reminder-email] resend threw:", err);
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
