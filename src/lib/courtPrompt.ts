// Shared logic for the crowd-sourced court-availability prompts.
//
// Two delivery surfaces feed the same court_availability_reports table:
//   1. CourtStatusReporter — manual, on a court card, gated by a single GPS
//      proximity read (no game context).
//   2. GameCourtPrompt — in a confirmed game's chat, gated by participation +
//      the game's time window (no GPS).
// Both only make sense on courts where "is a court open right now?" is useful
// crowd info, so they share one eligibility set and one window definition.

import type { Facility } from "./facilities";

// Categories where players crowd-source empty-court reports. Private clubs,
// HOA courts, and indoor facilities are excluded — availability there isn't
// something a passing player can usefully report.
export const ELIGIBLE_REPORT_CATEGORIES: ReadonlySet<Facility["category"]> = new Set([
  "public_park",
  "school",
  "college",
]);

export function isReportEligibleCategory(category: string | null | undefined): boolean {
  return !!category && ELIGIBLE_REPORT_CATEGORIES.has(category as Facility["category"]);
}

// Players may report from 30 min before start through the end of the game —
// matches the report_court_availability RPC's server-side window.
export const PROMPT_WINDOW_BEFORE_MS = 30 * 60 * 1000;
const DEFAULT_DURATION_MIN = 90;

export interface GameTiming {
  playDate: string; // "YYYY-MM-DD"
  playTime: string; // "HH:MM"
  playDuration: number | null; // minutes
}

/**
 * Wall-clock start/end of a game in epoch ms. Parses play_date + play_time in
 * the browser's local zone — same as the old arrival detector and correct for
 * the common Seattle case. The RPC enforces the precise play_timezone boundary,
 * so this only governs when the prompt card is *shown*, not whether a report is
 * accepted. Returns null when the date/time can't be parsed.
 */
export function gameWindowMs(timing: GameTiming): { startMs: number; endMs: number } | null {
  if (!timing.playDate || !timing.playTime) return null;
  const startMs = new Date(`${timing.playDate}T${timing.playTime}:00`).getTime();
  if (!Number.isFinite(startMs)) return null;
  const durationMin =
    timing.playDuration && timing.playDuration > 0 ? timing.playDuration : DEFAULT_DURATION_MIN;
  return { startMs, endMs: startMs + durationMin * 60 * 1000 };
}

/** True when `nowMs` falls in [startMs − 30min, endMs]. */
export function isWithinPromptWindow(startMs: number, endMs: number, nowMs: number): boolean {
  return nowMs >= startMs - PROMPT_WINDOW_BEFORE_MS && nowMs <= endMs;
}
