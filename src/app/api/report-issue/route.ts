import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { ipFor, checkRateLimit, isPlausibleEmail } from "@/lib/reportRateLimit";

/**
 * POST /api/report-issue
 *
 * Receives an issue report from a court card and emails it to REPORT_EMAIL
 * via Resend. Returns:
 *   200  → email sent
 *   400  → validation failure (field-specific message)
 *   429  → rate-limited (per IP, 5 reports / 10 min, shared with sibling
 *          /api/report-missing-court so a user can't dodge by alternating)
 *   503  → RESEND_API_KEY missing (graceful "not set up")
 *   500  → Resend or runtime failure
 *
 * No auth required; rate-limit is the only guard.
 */

const MAX_ISSUE = 2000;
const MIN_ISSUE = 10;
const MAX_COURT_NAME = 200;
const MAX_COURT_ID = 64;
const MAX_EMAIL = 256;

export async function POST(request: NextRequest) {
  // ── Parse + validate body ───────────────────────────────────────
  // Validation runs BEFORE the rate limit so 400s and 503s don't consume
  // a user's per-IP quota — only actual send attempts do.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }
  const {
    courtId,
    courtName,
    courtAddress,
    issue,
    reporterEmail,
  } = body as {
    courtId?: unknown;
    courtName?: unknown;
    courtAddress?: unknown;
    issue?: unknown;
    reporterEmail?: unknown;
  };

  if (typeof courtId !== "string" || courtId.length === 0 || courtId.length > MAX_COURT_ID) {
    return NextResponse.json({ error: "courtId is required" }, { status: 400 });
  }
  if (typeof courtName !== "string" || courtName.length === 0 || courtName.length > MAX_COURT_NAME) {
    return NextResponse.json({ error: "courtName is required" }, { status: 400 });
  }
  if (courtAddress != null && typeof courtAddress !== "string") {
    return NextResponse.json({ error: "courtAddress must be a string or null" }, { status: 400 });
  }
  if (typeof issue !== "string" || issue.trim().length < MIN_ISSUE) {
    return NextResponse.json(
      { error: `Please describe the issue (at least ${MIN_ISSUE} characters).` },
      { status: 400 }
    );
  }
  if (issue.length > MAX_ISSUE) {
    return NextResponse.json(
      { error: `Issue is too long (max ${MAX_ISSUE} characters).` },
      { status: 400 }
    );
  }
  let cleanReporterEmail: string | undefined;
  if (reporterEmail != null && reporterEmail !== "") {
    if (typeof reporterEmail !== "string" || reporterEmail.length > MAX_EMAIL || !isPlausibleEmail(reporterEmail)) {
      return NextResponse.json({ error: "reporterEmail doesn't look like an email." }, { status: 400 });
    }
    cleanReporterEmail = reporterEmail;
  }

  // ── Service availability ────────────────────────────────────────
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Reporting isn't set up yet." },
      { status: 503 }
    );
  }
  const recipient = process.env.REPORT_EMAIL || "your-email@example.com";

  // ── Rate limit ──────────────────────────────────────────────────
  // Only count actual sends. Mistypes (400) and unconfigured-service (503)
  // don't burn slots.
  const ip = ipFor(request);
  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Please wait before sending another report." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  // ── Send via Resend ─────────────────────────────────────────────
  const origin =
    request.headers.get("origin") ||
    `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  const url = `${origin}/courts/${encodeURIComponent(courtId)}`;

  const text = [
    `Court: ${courtName}`,
    `ID: ${courtId}`,
    `Address: ${courtAddress ?? "—"}`,
    `URL: ${url}`,
    `Reporter: ${cleanReporterEmail ?? "(anonymous)"}`,
    "",
    "Issue:",
    issue.trim(),
  ].join("\n");

  const isDev = process.env.NODE_ENV !== "production";
  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: "TennisFriend Reports <reports@mytennisfriends.com>",
      to: recipient,
      subject: `[TennisFriend] Issue: ${courtName}`,
      text,
      ...(cleanReporterEmail ? { replyTo: cleanReporterEmail } : {}),
    });
    if (error) {
      console.error("[report-issue] resend error:", error);
      // In dev, bubble the real Resend message to the client so you don't
      // have to dig in the terminal. In prod, stay generic so we don't leak
      // service details to end users.
      const message = isDev
        ? `Resend error: ${error.message ?? JSON.stringify(error)}`
        : "Couldn't send the report. Please try again.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[report-issue] resend threw:", err);
    const message = isDev
      ? `Resend threw: ${err instanceof Error ? err.message : String(err)}`
      : "Couldn't send the report. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
