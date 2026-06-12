/**
 * Shared, network-free helpers for turning ActiveNet day availability into the
 * "open windows" the app serves, and into the nightly snapshot rows.
 *
 * Used by both the live API route (/api/courts/availability) and the snapshot
 * cron (/api/cron/snapshot-availability) so the filtering rules can't drift
 * between "what we show live" and "what we freeze for today". Pure — unit-
 * tested without any network or DB.
 */
import type { DayAvailability, Timeslot } from "./activenet";

// ActiveNet sometimes reports 1-minute "open" slivers — boundary gaps between
// adjacent bookings. They aren't real bookable windows, so anything shorter
// than a plausible reservation is dropped.
export const MIN_SLOT_MINUTES = 30;

export function slotMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

/** A day's actionable open windows: available and at least MIN_SLOT_MINUTES. */
export function openWindows(slots: Timeslot[]): Timeslot[] {
  return slots.filter(
    (s) => s.available && slotMinutes(s.startTime, s.endTime) >= MIN_SLOT_MINUTES
  );
}

/** Compact window for storage: just the start/end clock strings. */
export interface SnapshotWindow {
  start: string; // "HH:mm:ss"
  end: string; // "HH:mm:ss"
}

export function toSnapshotWindows(slots: Timeslot[]): SnapshotWindow[] {
  return openWindows(slots).map((s) => ({ start: s.startTime, end: s.endTime }));
}

/** One persisted snapshot row (mirrors public.court_availability_snapshot). */
export interface SnapshotRow {
  center_id: number;
  resource_id: number;
  date: string; // "YYYY-MM-DD"
  windows: SnapshotWindow[];
  day_status: number;
}

/**
 * Rows worth persisting from a resource's multi-day availability.
 *
 * Only status-0 (bookable) days are kept. This is the crux of the "today" fix:
 * once a date becomes today it flips to status 7 (same-day, no online booking)
 * and ActiveNet returns no windows — capturing that would wipe the real
 * schedule. Skipping non-zero statuses means the snapshot from the date's last
 * bookable night survives to be served as "today".
 */
export function buildSnapshotRows(
  centerId: number,
  resourceId: number,
  days: DayAvailability[]
): SnapshotRow[] {
  const rows: SnapshotRow[] = [];
  for (const day of days) {
    if (day.status !== 0) continue;
    rows.push({
      center_id: centerId,
      resource_id: resourceId,
      date: day.date,
      windows: toSnapshotWindows(day.slots),
      day_status: 0,
    });
  }
  return rows;
}

/** "HH:mm[:ss]" → minutes from midnight (e.g. "17:15:00" → 1035). */
export function clockToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Does an open window [winStart, winEnd] overlap the requested filter range?
 * A null bound means "unbounded" on that side (i.e. an "any time" search).
 * Touching endpoints don't count as overlap (a window ending exactly at the
 * range start isn't usable for that range).
 */
export function windowOverlaps(
  winStartMin: number,
  winEndMin: number,
  rangeStartMin: number | null,
  rangeEndMin: number | null
): boolean {
  const lo = rangeStartMin ?? Number.NEGATIVE_INFINITY;
  const hi = rangeEndMin ?? Number.POSITIVE_INFINITY;
  return winStartMin < hi && winEndMin > lo;
}

/** Rehydrate stored windows into Timeslots for a date (all marked available —
 *  a snapshot only ever holds windows that were open). */
export function windowsToSlots(date: string, windows: SnapshotWindow[]): Timeslot[] {
  return windows.map((w) => ({
    date,
    startTime: w.start,
    endTime: w.end,
    available: true,
  }));
}
