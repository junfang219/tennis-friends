import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import {
  getFacilityByCourtId,
  getSeattleParksDashboardUrl,
} from "@/lib/facilities";

// Court detail is sourced from the scraped facility dataset
// (`src/lib/facilities.ts` → `data/tennis_courts.json`). Legacy `sea-N` IDs
// from the old hardcoded SEATTLE_COURTS array are no longer served — those
// reviews remain in the DB but are unreachable from the map.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const facility = getFacilityByCourtId(id);
  if (!facility) {
    return NextResponse.json({ error: "Court not found" }, { status: 404 });
  }

  // SCHEMA §external_resources: the Power BI availability dashboard applies
  // only to reservable Seattle Parks venues (managed_by + booking_url set).
  // Per-venue `show_availability_dashboard: false` opts a specific venue out
  // (e.g. Ingraham HS Complex, which isn't on the dashboard's reservable list).
  const dashboardUrl =
    facility.managedBy === "Seattle Parks & Recreation" &&
    facility.bookingUrl &&
    facility.showAvailabilityDashboard
      ? getSeattleParksDashboardUrl()
      : null;

  return NextResponse.json({ ...facility, dashboardUrl });
}

// ── PATCH (dev-only) — drag-to-edit pin coordinates ──────────────────
// Updates `latitude` / `longitude` for the given venue directly in
// data/tennis_courts.json. Disabled in production (returns 404) so the
// endpoint doesn't exist on deployed sites. See plan at
// /Users/junfang/.claude/plans/push-all-code-to-inherited-rose.md
const SOURCE = resolve(process.cwd(), "data/tennis_courts.json");

// Rough WA-state envelope. Anything outside this is almost certainly a
// fat-finger drag (e.g. the marker yeeted itself across the map).
const SANITY_BBOX = { south: 44, north: 50, west: -125, east: -116 };

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { id } = await params;
  const facility = getFacilityByCourtId(id);
  if (!facility) {
    return NextResponse.json({ error: "Court not found" }, { status: 404 });
  }

  // Parse + validate body. Hand-written rather than Zod because the project
  // doesn't have Zod installed and this is a 2-field schema.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }
  const { latitude, longitude } = body as { latitude?: unknown; longitude?: unknown };
  if (typeof latitude !== "number" || !Number.isFinite(latitude)) {
    return NextResponse.json({ error: "latitude must be a finite number" }, { status: 400 });
  }
  if (typeof longitude !== "number" || !Number.isFinite(longitude)) {
    return NextResponse.json({ error: "longitude must be a finite number" }, { status: 400 });
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
          "Coordinates outside the Washington-state sanity bbox. " +
          "If this is intentional, edit data/tennis_courts.json directly.",
      },
      { status: 400 }
    );
  }

  // Read → mutate → atomic write. The temp-file + rename dance ensures we
  // never leave a half-written JSON file if the process dies mid-save.
  let raw: string;
  try {
    raw = await readFile(SOURCE, "utf8");
  } catch (err) {
    console.error("[PATCH /api/courts/[id]] read failed:", err);
    return NextResponse.json({ error: "Failed to read dataset" }, { status: 500 });
  }
  let dataset: { venues: Array<{ id: number; latitude: number | null; longitude: number | null }> };
  try {
    dataset = JSON.parse(raw);
  } catch (err) {
    console.error("[PATCH /api/courts/[id]] parse failed:", err);
    return NextResponse.json({ error: "Dataset is corrupted" }, { status: 500 });
  }
  const venue = dataset.venues.find((v) => v.id === facility.externalId);
  if (!venue) {
    // Shouldn't happen — getFacilityByCourtId returned a facility, so the
    // venue must be in the dataset. Defensive 500 in case of a race.
    return NextResponse.json({ error: "Venue missing from dataset" }, { status: 500 });
  }
  venue.latitude = latitude;
  venue.longitude = longitude;

  const tmp = `${SOURCE}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(dataset, null, 2) + "\n", "utf8");
    await rename(tmp, SOURCE);
  } catch (err) {
    console.error("[PATCH /api/courts/[id]] write failed:", err);
    return NextResponse.json({ error: "Failed to write dataset" }, { status: 500 });
  }

  // facilities lib will pick up the new mtime on the next call; force a
  // re-read here so the response reflects the saved state.
  const updated = getFacilityByCourtId(id);
  return NextResponse.json(updated ?? { externalId: facility.externalId, latitude, longitude });
}
