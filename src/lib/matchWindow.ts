// Match scheduling states + window helpers. USTA schedules sit on a spectrum
// (see docs/community-teams-usta-design.md): fixed slots, week windows where
// captains negotiate the exact time, and floating/TBD matches with a play-by
// deadline. Pure — shared by the availability page, import plan, and the
// poll-prefill flow; unit-tested in matchWindow.test.ts.

export type SchedulingStatus = "fixed" | "window" | "tbd";

export function parseSchedulingStatus(raw: string | null | undefined): SchedulingStatus {
  return raw === "window" || raw === "tbd" ? raw : "fixed";
}

// Availability polls cap candidate_dates at 60 (DB CHECK); stay well under.
const MAX_POLL_DATES = 60;

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function windowEndFor(windowStartIso: string): string {
  // A "week window" spans the start date + 6 days (Mon..Sun style).
  return addDaysIso(windowStartIso, 6);
}

/**
 * Candidate dates for a "find a time" poll on an unscheduled match.
 * - window matches: every date from the anchor (window start) through
 *   window_end (inclusive; falls back to a 7-day week when window_end is
 *   missing or before the anchor).
 * - tbd matches (no window_end): `fallbackDays` dates from the anchor —
 *   the anchor is the play-by deadline is NOT assumed; callers pass the
 *   range they want the captain to start from.
 * Result is clamped to the polls table's candidate-date cap.
 */
export function matchWindowDates(
  anchorIso: string,
  windowEndIso: string | null,
  fallbackDays = 14
): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorIso)) return [];
  let count: number;
  if (windowEndIso && /^\d{4}-\d{2}-\d{2}$/.test(windowEndIso) && windowEndIso >= anchorIso) {
    const ms = Date.parse(`${windowEndIso}T00:00:00Z`) - Date.parse(`${anchorIso}T00:00:00Z`);
    count = Math.round(ms / 86_400_000) + 1;
  } else {
    count = fallbackDays;
  }
  count = Math.max(1, Math.min(count, MAX_POLL_DATES));
  return Array.from({ length: count }, (_, i) => addDaysIso(anchorIso, i));
}
