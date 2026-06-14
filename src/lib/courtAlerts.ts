/**
 * Pure, network/DB-free helpers for court availability alerts.
 *
 * The /api/cron/court-alerts job uses these to decide, for each subscription,
 * which bookable dates to check and whether a court's open windows satisfy the
 * alert's time-of-day window. Kept pure (mirroring courtAvailability.ts) so the
 * matching rules are unit-tested without ActiveNet or Supabase.
 */
import {
  clockToMinutes,
  windowOverlaps,
  type SnapshotWindow,
} from "./courtAvailability";

/** The bits of a court_alerts row the matching logic needs. */
export interface AlertMatchInput {
  mode: string; // 'once' | 'repeat'
  target_date: string | null; // 'YYYY-MM-DD' when mode='once'
  weekdays: number[] | null; // JS getDay() values (0=Sun) when mode='repeat'
  start_time: string | null; // 'HH:mm' window start, null = any
  end_time: string | null; // 'HH:mm' window end, null = any
}

/** Today's calendar date in Seattle (YYYY-MM-DD). */
function seattleToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(now);
}

/** Calendar arithmetic on a YYYY-MM-DD string (UTC-safe, no TZ drift). */
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Day-of-week (0=Sun … 6=Sat) for a YYYY-MM-DD calendar date. */
export function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The 14 bookable dates: tomorrow … +14 in Seattle time. Today is same-day and
 * not online-bookable (ActiveNet status 7), so it's excluded — same window the
 * map's "find open courts" finder offers.
 */
export function bookableDatesSeattle(now: Date): string[] {
  const today = seattleToday(now);
  return Array.from({ length: 14 }, (_, i) => addDays(today, i + 1));
}

/**
 * Which of the bookable dates this alert wants checked:
 *  - once   → its target_date, if still within the bookable window (else none)
 *  - repeat → every bookable date whose weekday is in the alert's set
 */
export function alertTargetDates(
  alert: AlertMatchInput,
  bookableDates: string[]
): string[] {
  if (alert.mode === "once") {
    return alert.target_date && bookableDates.includes(alert.target_date)
      ? [alert.target_date]
      : [];
  }
  if (alert.mode === "repeat" && alert.weekdays && alert.weekdays.length > 0) {
    const set = new Set(alert.weekdays);
    return bookableDates.filter((d) => set.has(weekdayOf(d)));
  }
  return [];
}

/**
 * True if any open window overlaps the alert's time-of-day window. Null bounds
 * mean "any time". Reuses the same overlap rule the finder uses, so an alert
 * fires for exactly the courts the user would see as "open" in that range.
 */
export function alertMatchesWindows(
  alert: AlertMatchInput,
  windows: SnapshotWindow[]
): boolean {
  const rangeStart = alert.start_time ? clockToMinutes(alert.start_time) : null;
  const rangeEnd = alert.end_time ? clockToMinutes(alert.end_time) : null;
  return windows.some((w) =>
    windowOverlaps(
      clockToMinutes(w.start),
      clockToMinutes(w.end),
      rangeStart,
      rangeEnd
    )
  );
}
