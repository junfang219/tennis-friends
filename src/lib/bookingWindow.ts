/**
 * Pure validation for saved court bookings — no network/DB deps so the
 * rules are unit-tested without Supabase (mirrors courtAlerts.ts).
 *
 * Seattle Parks policy context: outdoor courts book 1–3 h by minute-range,
 * Amy Yee indoor books 75-minute blocks, same-day online booking is
 * disabled (ActiveNet day status 7), and the online window extends roughly
 * 15–21 days out. The bounds here are deliberately looser than the policy
 * (30–240 min, today .. +30 days): we're recording what the user actually
 * booked on ActiveNet, not re-implementing ActiveNet's rules, so we only
 * reject inputs that can't be a real reservation.
 */
import { combineDateAndTime } from "./wallClock";

export const BOOKING_TIMEZONE = "America/Los_Angeles";
const MIN_DURATION_MIN = 30;
const MAX_DURATION_MIN = 240;
const MAX_DAYS_AHEAD = 30;

export interface BookingWindowInput {
  date: string; // 'YYYY-MM-DD'
  startTime: string; // 'HH:mm'
  endTime: string; // 'HH:mm'
  timezone?: string;
  /** Injected for tests; defaults to the real clock. */
  now?: Date;
}

export type BookingWindowResult =
  | { ok: true; start: Date; end: Date }
  | { ok: false; reason: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "HH:mm" → minutes from midnight. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** minutes from midnight → "HH:mm" (24h). */
function toClock(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/**
 * The end time to pre-fill for a booking: `start + maxMinutes`, but never past
 * the tapped free window's end. Used to default a booking to one hour (the
 * $16/hr courts' 1-hour minimum) instead of the whole free window the user
 * tapped, which can be several hours.
 */
export function defaultBookingEnd(
  startHHmm: string,
  windowEndHHmm: string,
  maxMinutes = 60
): string {
  const start = toMinutes(startHHmm);
  const windowEnd = toMinutes(windowEndHHmm);
  return toClock(Math.min(windowEnd, start + maxMinutes));
}

/** Calendar date in `tz` for the instant `now` (YYYY-MM-DD). */
function todayIn(tz: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
}

/** Calendar arithmetic on a YYYY-MM-DD string (UTC-safe, no TZ drift). */
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate()
  ).padStart(2, "0")}`;
}

/**
 * Validate a booking's wall-clock window and resolve it to UTC instants.
 * Date must fall between today and +30 days in the booking's timezone —
 * "today" is allowed even though ActiveNet only books next-day online,
 * because the user may save a booking they made by phone or in person.
 */
export function validateBookingWindow(
  input: BookingWindowInput
): BookingWindowResult {
  const { date, startTime, endTime } = input;
  const tz = input.timezone || BOOKING_TIMEZONE;
  const now = input.now ?? new Date();

  if (!DATE_RE.test(date)) {
    return { ok: false, reason: "Invalid date." };
  }
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
    return { ok: false, reason: "Invalid time." };
  }

  const start = combineDateAndTime(date, startTime, tz);
  const end = combineDateAndTime(date, endTime, tz);
  if (!start || !end) {
    return { ok: false, reason: "Invalid date or time." };
  }

  const durationMin = (end.getTime() - start.getTime()) / 60_000;
  if (durationMin <= 0) {
    return { ok: false, reason: "End time must be after start time." };
  }
  if (durationMin < MIN_DURATION_MIN || durationMin > MAX_DURATION_MIN) {
    return {
      ok: false,
      reason: `Bookings run ${MIN_DURATION_MIN} minutes to ${MAX_DURATION_MIN / 60} hours.`,
    };
  }

  const today = todayIn(tz, now);
  if (date < today) {
    return { ok: false, reason: "That date is in the past." };
  }
  if (date > addDays(today, MAX_DAYS_AHEAD)) {
    return { ok: false, reason: "That date is too far out to book." };
  }

  return { ok: true, start, end };
}
