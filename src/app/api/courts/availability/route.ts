import { NextResponse } from "next/server";
import { z } from "zod";
import { getSeattleVenueByCenterId } from "@/lib/activenetSeattleCourts";
import { fetchTimeslots, type Timeslot } from "@/lib/activenet";
import { openWindows, windowsToSlots, type SnapshotWindow } from "@/lib/courtAvailability";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Live tennis-court availability for one Seattle Parks venue on one day.
 *
 *   GET /api/courts/availability?center=<centerId>&date=YYYY-MM-DD
 *
 * The browser can't call ActiveNet directly (CORS), so this server route fans
 * out one `fetchTimeslots` call per court in the center (in parallel) and
 * returns each court's open windows for the requested day. Responses are
 * cached in-process for 2 min by fetchTimeslots. Individual court errors don't
 * blank the grid.
 *
 * TODAY fallback: ActiveNet returns nothing for today (status 7 — same-day
 * online booking is disabled), so for the current Seattle date we serve the
 * nightly snapshot captured while the date was last bookable (see
 * /api/cron/snapshot-availability). That's the schedule that's now frozen in.
 * `source` tells the client whether it's looking at live or snapshot data.
 */

// Live data keyed by query params — never statically cache the route itself.
export const dynamic = "force-dynamic";

const Query = z.object({
  center: z.coerce.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});

export interface CourtAvailability {
  resourceId: number;
  courtName: string;
  slots: Timeslot[]; // open windows only
  error: boolean; // true when this court's lookup failed
}

/** Current date in Seattle (en-CA formats as YYYY-MM-DD), independent of the
 *  server's UTC clock. */
function seattleToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(
    new Date()
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Query.safeParse({
    center: url.searchParams.get("center"),
    date: url.searchParams.get("date"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid parameters" },
      { status: 400 }
    );
  }

  const { center, date } = parsed.data;
  const venue = getSeattleVenueByCenterId(center);
  if (!venue) {
    return NextResponse.json({ error: "Unknown center" }, { status: 404 });
  }

  const results = await Promise.all(
    venue.courts.map(async (court) => {
      try {
        const days = await fetchTimeslots(court.resourceId, date);
        const slots = openWindows(days[0]?.slots ?? []);
        const court_: CourtAvailability = {
          resourceId: court.resourceId,
          courtName: court.name,
          slots,
          error: false,
        };
        return { court: court_, status: days[0]?.status ?? null };
      } catch {
        return {
          court: {
            resourceId: court.resourceId,
            courtName: court.name,
            slots: [],
            error: true,
          } as CourtAvailability,
          status: null,
        };
      }
    })
  );

  const courts = results.map((r) => r.court);
  // The same-day / out-of-window rule is venue-wide, so every court shares the
  // day status — take the first one we successfully read.
  const dayStatus = results.find((r) => !r.court.error)?.status ?? null;
  const totalLive = courts.reduce((n, c) => n + c.slots.length, 0);

  // Today + locked (status 7) + nothing live → serve last night's snapshot.
  const locked = dayStatus != null && dayStatus !== 0;
  if (date === seattleToday() && locked && totalLive === 0) {
    const snapshot = await loadSnapshot(center, date, venue.courts);
    if (snapshot) {
      return NextResponse.json({
        center,
        date,
        venueName: venue.name,
        dayStatus,
        source: "snapshot",
        snapshotAsOf: snapshot.asOf,
        courts: snapshot.courts,
      });
    }
  }

  return NextResponse.json({
    center,
    date,
    venueName: venue.name,
    dayStatus,
    source: "live",
    snapshotAsOf: null,
    courts,
  });
}

/** Pull the persisted snapshot for a center/date and shape it like the live
 *  courts payload. Returns null when there's no snapshot or the query fails
 *  (the caller then falls back to the live/empty result). */
async function loadSnapshot(
  center: number,
  date: string,
  venueCourts: { resourceId: number; name: string }[]
): Promise<{ courts: CourtAvailability[]; asOf: string | null } | null> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("court_availability_snapshot")
      .select("resource_id, windows, captured_at")
      .eq("center_id", center)
      .eq("date", date);
    if (error || !data || data.length === 0) return null;

    const byResource = new Map<number, SnapshotWindow[]>();
    let asOf: string | null = null;
    for (const row of data) {
      byResource.set(row.resource_id, (row.windows as unknown as SnapshotWindow[]) ?? []);
      if (!asOf || row.captured_at > asOf) asOf = row.captured_at;
    }

    const courts: CourtAvailability[] = venueCourts.map((court) => ({
      resourceId: court.resourceId,
      courtName: court.name,
      slots: windowsToSlots(date, byResource.get(court.resourceId) ?? []),
      error: false,
    }));
    return { courts, asOf };
  } catch {
    return null;
  }
}
