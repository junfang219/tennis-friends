import { Resend } from "resend";

const ANNOUNCEMENT_FROM = "TennisFriend <announcements@mytennisfriends.com>";

export type AnnouncementEmailOptions = {
  to: string[]; // member email addresses
  teamName: string;
  senderName: string;
  content: string;
  teamUrl: string; // link back to the team chat
};

/**
 * Fan out an announcement to a list of team-member emails via Resend's
 * batch API. Best-effort: a failure is logged, not thrown — the chat
 * message itself remains delivered via push/poll regardless of email.
 *
 * No-ops when RESEND_API_KEY is unset (local dev).
 */
export async function sendAnnouncementEmail(opts: AnnouncementEmailOptions): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[announcement-email] RESEND_API_KEY not set — skipping email fan-out.");
    return;
  }
  if (opts.to.length === 0) return;

  const text = [
    `${opts.senderName} posted an announcement to ${opts.teamName}:`,
    "",
    opts.content,
    "",
    `Open the team chat: ${opts.teamUrl}`,
    "",
    "— TennisFriend",
  ].join("\n");

  const safeContent = escapeHtml(opts.content).replace(/\n/g, "<br/>");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #1f2937;">
      <p style="font-size: 13px; color: #6b7280; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700;">
        📣 Announcement — ${escapeHtml(opts.teamName)}
      </p>
      <p style="font-size: 14px; line-height: 1.5; margin: 0 0 14px; color: #4b5563;">
        from <strong>${escapeHtml(opts.senderName)}</strong>
      </p>
      <div style="background: #f9fafb; border-left: 3px solid #2f7d4f; padding: 14px 16px; border-radius: 8px; font-size: 15px; line-height: 1.55; color: #111827;">
        ${safeContent}
      </div>
      <p style="margin: 20px 0 0;">
        <a href="${opts.teamUrl}" style="display: inline-block; background: #2f7d4f; color: white; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
          Open team chat
        </a>
      </p>
    </div>
  `;

  // Resend's batch endpoint sends one transactional email per recipient with
  // BCC-like isolation — every recipient sees themselves on the To: line.
  try {
    const resend = new Resend(apiKey);
    const subject = `[${opts.teamName}] ${opts.senderName} posted an announcement`;
    await Promise.all(
      opts.to.map((to) =>
        resend.emails.send({ from: ANNOUNCEMENT_FROM, to, subject, text, html }).catch((err) => {
          console.error(`[announcement-email] send to ${to} failed:`, err);
        })
      )
    );
  } catch (err) {
    console.error("[announcement-email] batch failed:", err);
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
