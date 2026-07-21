// Builds the lineup text message a captain sends from the Matches tab. Kept as
// a pure function (no React, no Supabase) so both send destinations — the
// in-app team chat and the native iOS share sheet — emit byte-identical text,
// and so the formatting is unit-testable. See lineupMessage.test.ts.

import type { LineupSlotDef } from "./leagueFormats";

const SLOT_ORDER: Record<string, number> = {
  S1: 1, S2: 2, S3: 3, S4: 4,
  D1: 5, D2: 6, D3: 7, D4: 8,
  Reserve: 9,
};

export function compareSlots(a: string, b: string) {
  const ao = SLOT_ORDER[a];
  const bo = SLOT_ORDER[b];
  if (ao !== undefined && bo !== undefined) return ao - bo;
  if (ao !== undefined) return -1;
  if (bo !== undefined) return 1;
  return a.localeCompare(b);
}

export function formatDateHeader(iso: string) {
  if (!iso) return "";
  // matchDate is "YYYY-MM-DD" — append T00:00 to avoid TZ shifts
  const d = new Date(`${iso}T00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// Minimal structural shape this builder needs — a subset of the page's Match.
export type LineupMatch = {
  matchDate: string;
  matchTime: string;
  location: string;
  opponent: string;
  // Season lineup format, when the team set one: the message then lists every
  // format slot in order (unfilled ones as "TBD") so gaps are visible, with
  // any extra assigned slots (Reserve, custom) appended after.
  format?: LineupSlotDef[] | null;
  availabilities: { lineupSlot: string; user: { name: string } }[];
};

// Returns the formatted lineup text, or null when no player is assigned to a
// slot yet (the caller surfaces an "assign someone first" message).
export function buildLineupText(match: LineupMatch): string | null {
  const assigned = match.availabilities.filter((a) => a.lineupSlot && a.lineupSlot.trim());
  if (assigned.length === 0) return null;

  // Group assigned players by slot, in canonical order.
  const bySlot = new Map<string, string[]>();
  for (const a of assigned) {
    const slot = a.lineupSlot.trim();
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot)!.push(a.user.name);
  }
  let lineupLines: string[];
  if (match.format && match.format.length > 0) {
    const formatCodes = new Set(match.format.map((s) => s.code));
    const formatLines = match.format.map(
      (s) => `${s.code}: ${bySlot.get(s.code)?.join(" & ") ?? "TBD"}`
    );
    const extraLines = Array.from(bySlot.keys())
      .filter((slot) => !formatCodes.has(slot))
      .sort(compareSlots)
      .map((slot) => `${slot}: ${bySlot.get(slot)!.join(" & ")}`);
    lineupLines = [...formatLines, ...extraLines];
  } else {
    const sortedSlots = Array.from(bySlot.keys()).sort(compareSlots);
    lineupLines = sortedSlots.map((slot) => `${slot}: ${bySlot.get(slot)!.join(" & ")}`);
  }

  const header = `🎾 Lineup for ${formatDateHeader(match.matchDate)}${match.matchTime ? ` at ${match.matchTime}` : ""}\n📍 ${match.location}${match.opponent ? `\n🆚 ${match.opponent}` : ""}\n\n`;
  return header + lineupLines.join("\n");
}
