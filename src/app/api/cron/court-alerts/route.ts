import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { postPushFanout } from "@/lib/pushFanout";
import { sendCourtAlertEmail } from "@/lib/courtAlertEmail";
import { getFacilityByCourtId } from "@/lib/facilities";
import {
  resolveAvailabilityTarget,
  getSeattleVenueByCenterId,
} from "@/lib/activenetSeattleCourts";
import { fetchTimeslots } from "@/lib/activenet";
import {
  toSnapshotWindows,
  clockToMinutes,
  windowOverlaps,
  type SnapshotWindow,
} from "@/lib/courtAvailability";
import {
  bookableDatesSeattle,
  alertTargetDates,
  alertMatchesWindows,
  type AlertMatchInput,
} from "@/lib/courtAlerts";

/**
 * Court-availability alerts cron — triggered every ~15 min by the
 * `court-alerts-poll` pg_cron job, which net.http_get's this route with the
 * CRON_SECRET bearer.
 *
 * For each active court_alerts row it resolves which bookable dates the alert
 * wants (a specific day, or repeating weekdays), polls live ActiveNet for ONLY
 * the venues/dates that have a subscription (a small, bounded set — far cheaper
 * than the nightly fleet snapshot), and when any reservable court at the venue
 * has an open window overlapping the alert's time-of-day range, notifies the
 * owner via push and/or email plus an in-app bell row.
 *
 * Idempotency: a court_alert_sent (alert_id, date) row makes each alert fire at
 * most once per date — the same pattern as reminder_sent. One-off alerts flip
 * to inactive after firing (and any whose date has passed are swept).
 *
 * Auth: rejects anything but `Authorization: Bearer <CRON_SECRET>` so the route
 * can't be abused as an unauthenticated notification relay.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CONCURRENCY = 8;

type AlertRow = AlertMatchInput & {
  id: string;
  user_id: string;
  court_id: string;
  notify_push: boolean;
  notify_email: boolean;
};

/** Run an async mapper over items with a fixed concurrency cap. */
async function mapPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      await fn(items[i++]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
}

/** Reservable resource IDs for a catalog court (respects split-venue filters). */
function resourcesForCourt(courtId: string): number[] {
  // resolveAvailabilityTarget keys split venues off courtId, but resolves
  // normal venues via the facility's booking URL / name — pass all three (the
  // same way the court detail page does) or non-split centers won't resolve.
  const facility = getFacilityByCourtId(courtId);
  const target = resolveAvailabilityTarget({
    courtId,
    bookingUrl: facility?.bookingUrl,
    name: facility?.name,
  });
  if (!target) return [];
  const venue = getSeattleVenueByCenterId(target.centerId);
  if (!venue) return [];
  return venue.courts
    .filter(
      (c) =>
        c.reservable &&
        (target.courtNameIncludes
          ? c.name.includes(target.courtNameIncludes)
          : true)
    )
    .map((c) => c.resourceId);
}

/** The open span within the alert's window, as minutes-from-midnight. */
function matchedSpan(
  windows: SnapshotWindow[],
  startTime: string | null,
  endTime: string | null
): { startMin: number; endMin: number } | null {
  const rangeStart = startTime ? clockToMinutes(startTime) : null;
  const rangeEnd = endTime ? clockToMinutes(endTime) : null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const w of windows) {
    const ws = clockToMinutes(w.start);
    const we = clockToMinutes(w.end);
    if (!windowOverlaps(ws, we, rangeStart, rangeEnd)) continue;
    const cs = rangeStart != null ? Math.max(ws, rangeStart) : ws;
    const ce = rangeEnd != null ? Math.min(we, rangeEnd) : we;
    if (cs < lo) lo = cs;
    if (ce > hi) hi = ce;
  }
  return hi > lo ? { startMin: lo, endMin: hi } : null;
}

function clock(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}` : `${h12}:${String(m).padStart(2, "0")}`;
}
function ampm(min: number): string {
  return min < 720 || min === 1440 ? "am" : "pm";
}
function formatSpan(startMin: number, endMin: number): string {
  return ampm(startMin) === ampm(endMin)
    ? `${clock(startMin)}–${clock(endMin)}${ampm(endMin)}`
    : `${clock(startMin)}${ampm(startMin)}–${clock(endMin)}${ampm(endMin)}`;
}

/**
 * Trim a trailing "Tennis Court(s)/Center" (plus an abbreviation parenthetical
 * when it sits at the very end, e.g. "Tennis Center (AYTC)") so the push title
 * "<venue> has an open court" doesn't read redundantly. Only used for the push
 * banner — the in-app row and email keep the full catalog name. Falls back to
 * the full name if trimming would empty it.
 *   "Amy Yee Tennis Center (AYTC)"                  → "Amy Yee"
 *   "Lower Woodland Playfield Tennis Courts"        → "Lower Woodland Playfield"
 *   "...Athletic Complex (SWAC) Tennis Courts"      → "...Athletic Complex (SWAC)"
 *   "Volunteer Park"                                → "Volunteer Park"
 */
function shortVenueName(name: string): string {
  const trimmed = name
    .replace(/\s+Tennis\s+(?:Courts?|Center)\s*(?:\([^)]*\))?\s*$/i, "")
    .trim();
  return trimmed || name;
}

function dateLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const now = new Date();
  const bookable = bookableDatesSeattle(now);
  const today = bookable.length > 0 ? addDays(bookable[0], -1) : null;

  const { data: alertsData, error: alertsErr } = await admin
    .from("court_alerts")
    .select(
      "id, user_id, court_id, mode, target_date, weekdays, start_time, end_time, notify_push, notify_email"
    )
    .eq("active", true);
  if (alertsErr) {
    return NextResponse.json({ error: alertsErr.message }, { status: 500 });
  }
  const alerts = (alertsData ?? []) as AlertRow[];

  // What each alert wants checked, and the union of work that implies.
  const alertDates = new Map<string, string[]>(); // alert.id → dates
  const neededDates = new Set<string>();
  const resourcesByCourt = new Map<string, number[]>();
  const neededResources = new Set<number>();

  for (const a of alerts) {
    const dates = alertTargetDates(a, bookable);
    if (dates.length === 0) continue;
    alertDates.set(a.id, dates);
    dates.forEach((d) => neededDates.add(d));
    if (!resourcesByCourt.has(a.court_id)) {
      resourcesByCourt.set(a.court_id, resourcesForCourt(a.court_id));
    }
    resourcesByCourt.get(a.court_id)!.forEach((r) => neededResources.add(r));
  }

  // Fetch each needed court's live availability once for the whole window.
  const sortedDates = [...neededDates].sort();
  const minDate = sortedDates[0];
  const maxDate = sortedDates[sortedDates.length - 1];
  const availByResource = new Map<number, Map<string, SnapshotWindow[]>>();
  let fetchErrors = 0;

  if (minDate && maxDate) {
    await mapPool([...neededResources], CONCURRENCY, async (resourceId) => {
      try {
        const days = await fetchTimeslots(resourceId, minDate, maxDate);
        const byDate = new Map<string, SnapshotWindow[]>();
        for (const day of days) {
          byDate.set(day.date, toSnapshotWindows(day.slots));
        }
        availByResource.set(resourceId, byDate);
      } catch {
        fetchErrors += 1;
      }
    });
  }

  const venueWindows = (courtId: string, date: string): SnapshotWindow[] => {
    const resources = resourcesByCourt.get(courtId) ?? [];
    const out: SnapshotWindow[] = [];
    for (const r of resources) {
      const w = availByResource.get(r)?.get(date);
      if (w) out.push(...w);
    }
    return out;
  };

  // Which (alert, date) pairs have already fired.
  const sentKeys = new Set<string>();
  const candidateIds = [...alertDates.keys()];
  if (candidateIds.length > 0) {
    const { data: sent } = await admin
      .from("court_alert_sent")
      .select("alert_id, date")
      .in("alert_id", candidateIds);
    for (const row of sent ?? []) sentKeys.add(`${row.alert_id}|${row.date}`);
  }

  const origin = new URL(request.url).origin;
  let fired = 0;
  const deactivate: string[] = [];
  const errors: string[] = [];

  for (const a of alerts) {
    const dates = alertDates.get(a.id);
    if (!dates) {
      // No live work this tick. Sweep one-off alerts whose day has passed.
      if (a.mode === "once" && today && a.target_date && a.target_date < today) {
        deactivate.push(a.id);
      }
      continue;
    }
    for (const date of dates) {
      if (sentKeys.has(`${a.id}|${date}`)) continue;
      const windows = venueWindows(a.court_id, date);
      if (!alertMatchesWindows(a, windows)) continue;

      const span = matchedSpan(windows, a.start_time, a.end_time);
      const venueName = getFacilityByCourtId(a.court_id)?.name ?? "A court";
      const whenLabel = dateLabel(date);
      const spanLabel = span
        ? formatSpan(span.startMin, span.endMin)
        : "open now";
      const bookUrl = `${origin}/courts/${encodeURIComponent(a.court_id)}?date=${date}`;

      // Push first; a hard 5xx means leave it unrecorded so the next tick
      // retries (matches the reminder cron's rule). Missing-config no-ops
      // count as delivered.
      if (a.notify_push) {
        const res = await postPushFanout([a.user_id], {
          title: `${shortVenueName(venueName)} has an open court`,
          body: `${whenLabel} · ${spanLabel} — tap to book`,
          threadId: `court-alert:${a.id}`,
          data: { kind: "court_available", courtId: a.court_id, date },
        });
        if (!res.ok && res.status >= 500) {
          errors.push(`push ${res.status}: ${res.error ?? "no detail"}`);
          continue;
        }
      }

      if (a.notify_email) {
        const { data: profile } = await admin
          .from("profiles")
          .select("email")
          .eq("id", a.user_id)
          .maybeSingle();
        if (profile?.email) {
          void sendCourtAlertEmail({
            to: profile.email,
            venueName,
            whenLabel,
            spanLabel,
            bookUrl,
          });
        }
      }

      await admin.from("notifications").insert({
        user_id: a.user_id,
        actor_id: a.user_id,
        type: "court_available",
        court_id: a.court_id,
      });

      const { error: sentErr } = await admin
        .from("court_alert_sent")
        .insert({ alert_id: a.id, date });
      if (sentErr && !sentErr.message.toLowerCase().includes("duplicate")) {
        errors.push(`court_alert_sent: ${sentErr.message}`);
      }
      fired += 1;
      if (a.mode === "once") deactivate.push(a.id);
    }
  }

  if (deactivate.length > 0) {
    await admin
      .from("court_alerts")
      .update({ active: false })
      .in("id", [...new Set(deactivate)]);
  }

  return NextResponse.json({
    alertsChecked: alerts.length,
    fired,
    fetchErrors,
    errors: errors.slice(0, 5),
  });
}

/** Calendar arithmetic on a YYYY-MM-DD string. */
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
