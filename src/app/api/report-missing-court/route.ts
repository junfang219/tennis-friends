import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { ipFor, checkRateLimit, isPlausibleEmail } from "@/lib/reportRateLimit";

/**
 * POST /api/report-missing-court
 *
 * Receives a "this court isn't on the map" submission and emails it to
 * REPORT_EMAIL via Resend. Same response semantics as /api/report-issue:
 *   200  → email sent
 *   400  → validation failure (field-specific message)
 *   429  → rate-limited (shared counter with /api/report-issue)
 *   503  → RESEND_API_KEY missing
 *   500  → Resend or runtime failure
 */

const MAX_COURT_NAME = 200;
const MIN_COURT_NAME = 2;
const MAX_ADDRESS = 300;
const MAX_NOTES = 2000;
const MAX_EMAIL = 256;
const MIN_COURT_COUNT = 1;
const MAX_COURT_COUNT = 50;

// Same WA-state sanity bbox we use elsewhere — accepts coords within roughly
// WA state. Anything outside is almost certainly a fat-finger or wrong page.
const SANITY_BBOX = { south: 44, north: 50, west: -125, east: -116 };

const INDOOR_OUTDOOR_VALUES = new Set(["outdoor", "indoor", "both"]);
const MANAGED_BY_VALUES = new Set(["city", "club", "school", "other"]);

export async function POST(request: NextRequest) {
  // ── Parse + validate body. 400s and 503s don't burn rate-limit slots. ──
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
    courtName,
    latitude,
    longitude,
    address,
    courtCount,
    indoorOutdoor,
    managedBy,
    notes,
    reporterEmail,
  } = body as {
    courtName?: unknown;
    latitude?: unknown;
    longitude?: unknown;
    address?: unknown;
    courtCount?: unknown;
    indoorOutdoor?: unknown;
    managedBy?: unknown;
    notes?: unknown;
    reporterEmail?: unknown;
  };

  // Name
  if (typeof courtName !== "string") {
    return NextResponse.json({ error: "courtName is required" }, { status: 400 });
  }
  const cleanName = courtName.trim();
  if (cleanName.length < MIN_COURT_NAME || cleanName.length > MAX_COURT_NAME) {
    return NextResponse.json(
      { error: `Court name must be ${MIN_COURT_NAME}–${MAX_COURT_NAME} characters.` },
      { status: 400 }
    );
  }

  // Location — must have either valid lat+lng OR non-empty address.
  let cleanLat: number | null = null;
  let cleanLng: number | null = null;
  if (latitude != null || longitude != null) {
    if (
      typeof latitude !== "number" ||
      !Number.isFinite(latitude) ||
      typeof longitude !== "number" ||
      !Number.isFinite(longitude)
    ) {
      return NextResponse.json(
        { error: "latitude/longitude must both be finite numbers." },
        { status: 400 }
      );
    }
    if (
      latitude < SANITY_BBOX.south ||
      latitude > SANITY_BBOX.north ||
      longitude < SANITY_BBOX.west ||
      longitude > SANITY_BBOX.east
    ) {
      return NextResponse.json(
        {
          error:
            "Coordinates are outside the Washington-state area. " +
            "If this is intentional, send the address instead.",
        },
        { status: 400 }
      );
    }
    cleanLat = latitude;
    cleanLng = longitude;
  }
  let cleanAddress: string | null = null;
  if (address != null && address !== "") {
    if (typeof address !== "string" || address.length > MAX_ADDRESS) {
      return NextResponse.json(
        { error: `Address must be a string up to ${MAX_ADDRESS} characters.` },
        { status: 400 }
      );
    }
    const trimmed = address.trim();
    if (trimmed.length > 0) cleanAddress = trimmed;
  }
  if (cleanLat == null && cleanAddress == null) {
    return NextResponse.json(
      { error: "Either coordinates or an address is required." },
      { status: 400 }
    );
  }

  // Optional details
  let cleanCourtCount: number | null = null;
  if (courtCount != null) {
    if (
      typeof courtCount !== "number" ||
      !Number.isInteger(courtCount) ||
      courtCount < MIN_COURT_COUNT ||
      courtCount > MAX_COURT_COUNT
    ) {
      return NextResponse.json(
        { error: `Court count must be an integer between ${MIN_COURT_COUNT} and ${MAX_COURT_COUNT}.` },
        { status: 400 }
      );
    }
    cleanCourtCount = courtCount;
  }
  let cleanIndoorOutdoor: string | null = null;
  if (indoorOutdoor != null && indoorOutdoor !== "") {
    if (typeof indoorOutdoor !== "string" || !INDOOR_OUTDOOR_VALUES.has(indoorOutdoor)) {
      return NextResponse.json(
        { error: "indoorOutdoor must be one of outdoor/indoor/both." },
        { status: 400 }
      );
    }
    cleanIndoorOutdoor = indoorOutdoor;
  }
  let cleanManagedBy: string | null = null;
  if (managedBy != null && managedBy !== "") {
    if (typeof managedBy !== "string" || !MANAGED_BY_VALUES.has(managedBy)) {
      return NextResponse.json(
        { error: "managedBy must be one of city/club/school/other." },
        { status: 400 }
      );
    }
    cleanManagedBy = managedBy;
  }
  let cleanNotes: string | null = null;
  if (notes != null && notes !== "") {
    if (typeof notes !== "string" || notes.length > MAX_NOTES) {
      return NextResponse.json(
        { error: `Notes must be a string up to ${MAX_NOTES} characters.` },
        { status: 400 }
      );
    }
    const trimmed = notes.trim();
    if (trimmed.length > 0) cleanNotes = trimmed;
  }
  let cleanReporterEmail: string | undefined;
  if (reporterEmail != null && reporterEmail !== "") {
    if (
      typeof reporterEmail !== "string" ||
      reporterEmail.length > MAX_EMAIL ||
      !isPlausibleEmail(reporterEmail)
    ) {
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

  // ── Rate limit (only counts actual sends) ───────────────────────
  const ip = ipFor(request);
  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Please wait before sending another report." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  // ── Compose email body ──────────────────────────────────────────
  // Maps query: coordinates win when present (more precise pin); otherwise
  // the address text is geocoded by Google on the receiving end.
  const mapsQuery =
    cleanLat != null && cleanLng != null
      ? `${cleanLat},${cleanLng}`
      : (cleanAddress as string);
  const mapsUrl = `https://www.google.com/maps?q=${encodeURIComponent(mapsQuery)}`;

  const locationLine =
    cleanLat != null && cleanLng != null
      ? `${cleanLat}, ${cleanLng}` + (cleanAddress ? `  (also: ${cleanAddress})` : "")
      : (cleanAddress as string);

  const lines = [
    `Court name: ${cleanName}`,
    `Location:   ${locationLine}`,
    `Map link:   ${mapsUrl}`,
    `Courts:     ${cleanCourtCount ?? "—"}`,
    `Type:       ${cleanIndoorOutdoor ?? "—"}`,
    `Managed by: ${cleanManagedBy ?? "—"}`,
    `Reporter:   ${cleanReporterEmail ?? "(anonymous)"}`,
    "",
    "Notes:",
    cleanNotes ?? "—",
  ];

  // ── Send via Resend ─────────────────────────────────────────────
  const isDev = process.env.NODE_ENV !== "production";
  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: "TennisFriend Reports <reports@mytennisfriends.com>",
      to: recipient,
      subject: `[TennisFriend] Missing court: ${cleanName}`,
      text: lines.join("\n"),
      ...(cleanReporterEmail ? { replyTo: cleanReporterEmail } : {}),
    });
    if (error) {
      console.error("[report-missing-court] resend error:", error);
      const message = isDev
        ? `Resend error: ${error.message ?? JSON.stringify(error)}`
        : "Couldn't send the report. Please try again.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[report-missing-court] resend threw:", err);
    const message = isDev
      ? `Resend threw: ${err instanceof Error ? err.message : String(err)}`
      : "Couldn't send the report. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
