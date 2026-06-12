import { NextResponse } from "next/server";
import { z } from "zod";
import { getFacilities, getFacilityByCourtId, type Facility } from "@/lib/facilities";
import {
  resolveSeattleVenue,
  getCourtByResourceId,
  SPLIT_VENUE_OVERRIDES,
} from "@/lib/activenetSeattleCourts";
import {
  clockToMinutes,
  windowOverlaps,
  type SnapshotWindow,
} from "@/lib/courtAvailability";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Cross-venue "find open courts" search for the map filter.
 *
 *   GET /api/courts/available?date=YYYY-MM-DD[&start=HH:mm&end=HH:mm]
 *
 * Backed by the nightly court_availability_snapshot (one query for the whole
 * day across every venue) rather than fanning out ~130 live ActiveNet calls.
 * Returns one entry per venue that has at least one court whose open window
 * overlaps the requested time range (omit start/end for "any time"), with the
 * count of matching courts and the overall available span. Freshness is the
 * snapshot's `asOf`; the per-court grid on the detail page is the live source.
 */

export const dynamic = "force-dynamic";

const Query = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  start: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  end: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
});

// center_id → catalog facility, resolved the same way the detail page does
// (booking-URL center id, then a strict name match). Built once per process;
// the catalog and seed are static.
let centerToFacility: Map<number, Facility> | null = null;
function facilityForCenter(centerId: number): Facility | null {
  if (!centerToFacility) {
    centerToFacility = new Map();
    for (const f of getFacilities()) {
      const eligible =
        f.managedBy === "Seattle Parks & Recreation" &&
        !!f.bookingUrl &&
        f.showAvailabilityDashboard;
      if (!eligible) continue;
      const venue = resolveSeattleVenue({ bookingUrl: f.bookingUrl, name: f.name });
      if (venue && !centerToFacility.has(venue.centerId)) {
        centerToFacility.set(venue.centerId, f);
      }
    }
  }
  return centerToFacility.get(centerId) ?? null;
}

// Centers that one physical complex shares between two catalog venues
// (Lower/Upper Woodland). For these, a court belongs to a facility by its
// court-name tag, not just the center.
const SPLIT_CENTER_IDS = new Set(
  Object.values(SPLIT_VENUE_OVERRIDES).map((o) => o.centerId)
);

/** The catalog facility a single snapshot row (center + resource) belongs to. */
function facilityForRow(centerId: number, resourceId: number): Facility | null {
  if (SPLIT_CENTER_IDS.has(centerId)) {
    const court = getCourtByResourceId(resourceId);
    if (!court) return null;
    for (const [courtId, o] of Object.entries(SPLIT_VENUE_OVERRIDES)) {
      if (o.centerId === centerId && court.name.includes(o.courtNameIncludes)) {
        return getFacilityByCourtId(courtId);
      }
    }
    return null;
  }
  return facilityForCenter(centerId);
}

interface VenueMatch {
  courtId: string;
  centerId: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
  /** Number of distinct courts with a window overlapping the range. */
  courtCount: number;
  /** Overall available span across matching windows (minutes from midnight). */
  startMin: number;
  endMin: number;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Query.safeParse({
    date: url.searchParams.get("date"),
    start: url.searchParams.get("start") ?? undefined,
    end: url.searchParams.get("end") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid parameters" },
      { status: 400 }
    );
  }
  const { date, start, end } = parsed.data;
  const rangeStart = start ? clockToMinutes(start) : null;
  const rangeEnd = end ? clockToMinutes(end) : null;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("court_availability_snapshot")
    .select("center_id, resource_id, windows, captured_at")
    .eq("date", date);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Aggregate matching courts per catalog facility (a shared center like
  // Woodland splits into its Lower and Upper facilities here).
  const byFacility = new Map<
    string,
    { facility: Facility; centerId: number; resources: Set<number>; startMin: number; endMin: number }
  >();
  let asOf: string | null = null;
  for (const row of data ?? []) {
    const windows = (row.windows as unknown as SnapshotWindow[]) ?? [];
    let matchStart = Infinity;
    let matchEnd = -Infinity;
    for (const w of windows) {
      const ws = clockToMinutes(w.start);
      const we = clockToMinutes(w.end);
      if (windowOverlaps(ws, we, rangeStart, rangeEnd)) {
        // Clamp to the searched window so the displayed span reflects what's
        // open within the user's range (not the court's whole day).
        const cs = rangeStart != null ? Math.max(ws, rangeStart) : ws;
        const ce = rangeEnd != null ? Math.min(we, rangeEnd) : we;
        if (cs < matchStart) matchStart = cs;
        if (ce > matchEnd) matchEnd = ce;
      }
    }
    if (matchEnd <= matchStart) continue; // no overlapping window on this court

    const facility = facilityForRow(row.center_id, row.resource_id);
    if (!facility) continue;
    const g =
      byFacility.get(facility.courtId) ??
      {
        facility,
        centerId: row.center_id,
        resources: new Set<number>(),
        startMin: Infinity,
        endMin: -Infinity,
      };
    g.resources.add(row.resource_id);
    g.startMin = Math.min(g.startMin, matchStart);
    g.endMin = Math.max(g.endMin, matchEnd);
    byFacility.set(facility.courtId, g);
    if (!asOf || row.captured_at > asOf) asOf = row.captured_at;
  }

  const venues: VenueMatch[] = [];
  for (const g of byFacility.values()) {
    venues.push({
      courtId: g.facility.courtId,
      centerId: g.centerId,
      name: g.facility.name,
      latitude: g.facility.latitude,
      longitude: g.facility.longitude,
      courtCount: g.resources.size,
      startMin: g.startMin,
      endMin: g.endMin,
    });
  }
  venues.sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({
    date,
    start: rangeStart,
    end: rangeEnd,
    asOf,
    count: venues.length,
    venues,
  });
}
