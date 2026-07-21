// Pure USTA league helpers: division/level option lists, lineup-format
// presets, and lineup validation. No React, no Supabase — unit-testable, and
// shared by the season settings form and the availability lineup builder.
//
// Everything here is advisory. USTA rules are section-specific and re-issued
// every championship year, so validators return WARNINGS the captain can
// ignore — they never block saving a lineup. National floors below come from
// the 2026 USTA League National Regulations (1.04D); PNW variations noted
// inline.

export type SlotType = "singles" | "doubles";

// One court in a team match, e.g. { code: "D2", type: "doubles" }.
// Stored per season as jsonb on seasons.lineup_format (ordered array).
export type LineupSlotDef = { code: string; type: SlotType };

export type RatingScheme = "straight" | "combined";

export type LeagueDivision =
  | "adult_18"
  | "adult_40"
  | "adult_55"
  | "adult_65"
  | "mixed_18"
  | "mixed_40"
  | "combo"
  | "tri_level"
  | "other";

export const DIVISION_OPTIONS: { value: LeagueDivision; label: string }[] = [
  { value: "adult_18", label: "Adult 18 & Over" },
  { value: "adult_40", label: "Adult 40 & Over" },
  { value: "adult_55", label: "Adult 55 & Over" },
  { value: "adult_65", label: "Adult 65 & Over" },
  { value: "mixed_18", label: "Mixed 18 & Over" },
  { value: "mixed_40", label: "Mixed 40 & Over" },
  { value: "combo", label: "Combo" },
  { value: "tri_level", label: "Tri-Level" },
  { value: "other", label: "Other" },
];

// Divisions where the team level is a pair-sum (Mixed 6.0–10.0, 55/65&O
// 6.0–9.0, Combo x.5 levels) rather than an individual rating cap.
export function defaultRatingScheme(division: LeagueDivision): RatingScheme {
  switch (division) {
    case "mixed_18":
    case "mixed_40":
    case "adult_55":
    case "adult_65":
    case "combo":
      return "combined";
    default:
      return "straight";
  }
}

// Straight levels 2.5–5.5; combined pair-sum levels 5.5–10.0 (whole levels
// for Mixed/55&O, x.5 levels for Combo). Generous supersets on purpose —
// which levels a local league actually offers varies by section and year.
export function levelOptions(scheme: RatingScheme): number[] {
  const opts: number[] = [];
  if (scheme === "straight") {
    for (let v = 2.5; v <= 5.5; v += 0.5) opts.push(v);
  } else {
    for (let v = 5.5; v <= 10; v += 0.5) opts.push(v);
  }
  return opts.map((v) => Math.round(v * 10) / 10);
}

// Build the standard S1..Sn / D1..Dn slot list for an "n singles + m doubles"
// format — used by the presets below and the custom-format editor.
export function buildSlots(singles: number, doubles: number): LineupSlotDef[] {
  const out: LineupSlotDef[] = [];
  for (let i = 1; i <= singles; i++) out.push({ code: `S${i}`, type: "singles" });
  for (let i = 1; i <= doubles; i++) out.push({ code: `D${i}`, type: "doubles" });
  return out;
}

// Compact "2S+3D" style label for a format.
export function formatLabel(fmt: LineupSlotDef[]): string {
  const sg = fmt.filter((s) => s.type === "singles").length;
  const db = fmt.filter((s) => s.type === "doubles").length;
  return [sg ? `${sg}S` : "", db ? `${db}D` : ""].filter(Boolean).join("+");
}

// Common USTA scorecard formats. `hint` says where each is typically used so
// captains can pick without memorizing the regulations; "custom" lets them
// build anything (formats vary by section AND championship tier — e.g. PNW
// 40&O plays 1S+3D locally but 1S+4D at nationals).
export const LINEUP_PRESETS: { id: string; label: string; hint: string; slots: LineupSlotDef[] }[] = [
  { id: "2s3d", label: "2 singles + 3 doubles", hint: "Adult 18&O, levels 3.0–4.5", slots: buildSlots(2, 3) },
  { id: "1s2d", label: "1 singles + 2 doubles", hint: "Adult 18&O, levels 2.5 / 5.0", slots: buildSlots(1, 2) },
  { id: "1s3d", label: "1 singles + 3 doubles", hint: "Adult 40&O (PNW local play)", slots: buildSlots(1, 3) },
  { id: "1s4d", label: "1 singles + 4 doubles", hint: "Adult 40&O (national format)", slots: buildSlots(1, 4) },
  { id: "3d", label: "3 doubles", hint: "Adult 55&O / 65&O and Mixed", slots: buildSlots(0, 3) },
];

// Parse seasons.lineup_format jsonb into slot defs, dropping malformed
// entries so a bad row can't crash the lineup builder. Null/empty → null
// (free-form slots, the legacy behavior).
export function parseLineupFormat(raw: unknown): LineupSlotDef[] | null {
  if (!Array.isArray(raw)) return null;
  const parsed = raw.filter(
    (s): s is LineupSlotDef =>
      !!s &&
      typeof s === "object" &&
      typeof (s as LineupSlotDef).code === "string" &&
      (s as LineupSlotDef).code.trim() !== "" &&
      ((s as LineupSlotDef).type === "singles" || (s as LineupSlotDef).type === "doubles")
  );
  return parsed.length > 0 ? parsed : null;
}

// League identity fields of a season, as the UI consumes them (parsed camel
// shape of the seasons.* columns added in the community-teams migration).
export type SeasonLeague = {
  division: LeagueDivision | null;
  ratingScheme: RatingScheme | null;
  level: number | null;
  lineupFormat: LineupSlotDef[] | null;
};

export type LineupAssignment = {
  slotCode: string;
  players: { name: string; ntrp: number | null }[];
};

export type LineupWarning = {
  slotCode: string | null; // null = whole-lineup warning (e.g. below min courts)
  message: string;
};

// A slot counts as a fielded court when it has enough players to play it.
function slotFilled(def: LineupSlotDef, players: number): boolean {
  return players >= (def.type === "doubles" ? 2 : 1);
}

// PNW minimum courts to avoid a team default: 3-of-5, 3-of-4, 2-of-3 — i.e. a
// majority of the format's courts in every published case.
export function minCourtsRequired(totalCourts: number): number {
  return Math.floor(totalCourts / 2) + 1;
}

/**
 * Validate a lineup against the season's league config. Pure + warning-only:
 * captains stay in control (local leagues override national floors, players
 * get bumped mid-season, subs happen). Slots not present in `format`
 * (e.g. "Reserve" or custom codes) are ignored except for over-capacity
 * checks on codes that ARE in the format.
 */
export function validateLineup(
  league: SeasonLeague,
  assignments: LineupAssignment[]
): LineupWarning[] {
  const warnings: LineupWarning[] = [];
  const format = league.lineupFormat;
  if (!format) return warnings;

  const byCode = new Map(assignments.map((a) => [a.slotCode, a.players]));

  for (const def of format) {
    const players = byCode.get(def.code) ?? [];
    const capacity = def.type === "doubles" ? 2 : 1;

    if (players.length > capacity) {
      warnings.push({
        slotCode: def.code,
        message: `${def.code} has ${players.length} players — ${
          def.type === "doubles" ? "a doubles court takes 2" : "a singles court takes 1"
        }.`,
      });
    }

    if (league.level == null) continue;

    if (league.ratingScheme === "combined") {
      // Combined (Mixed/55&O/Combo): pair sum ≤ team level, partner gap ≤ 1.0.
      const rated = players.filter((p) => p.ntrp != null);
      if (def.type === "doubles" && rated.length === 2) {
        const [a, b] = rated;
        const sum = Math.round((a.ntrp! + b.ntrp!) * 10) / 10;
        if (sum > league.level) {
          warnings.push({
            slotCode: def.code,
            message: `${def.code}: ${a.name} + ${b.name} combine to ${sum.toFixed(1)}, over the ${league.level.toFixed(1)} team level.`,
          });
        }
        if (Math.abs(a.ntrp! - b.ntrp!) > 1.0) {
          warnings.push({
            slotCode: def.code,
            message: `${def.code}: ${a.name} and ${b.name} are more than 1.0 apart — USTA caps the partner gap at 1.0 in combined play.`,
          });
        }
      }
    } else {
      // Straight levels: no player may exceed the team level.
      for (const p of players) {
        if (p.ntrp != null && p.ntrp > league.level) {
          warnings.push({
            slotCode: def.code,
            message: `${p.name} is rated ${p.ntrp.toFixed(1)}, above the ${league.level.toFixed(1)} team level.`,
          });
        }
      }
    }
  }

  const filled = format.filter((def) => slotFilled(def, (byCode.get(def.code) ?? []).length)).length;
  const required = minCourtsRequired(format.length);
  if (filled < required) {
    warnings.push({
      slotCode: null,
      message: `Only ${filled} of ${format.length} courts are filled — fewer than ${required} means a team default in PNW play.`,
    });
  }

  return warnings;
}

// National minimum roster sizes (2026 regs 1.04D(4)); floors, not caps —
// sections may require more. Mixed is 3 men + 3 women; without gender data we
// surface it as 6 total. Returns null when no minimum is known.
export function rosterMinimumFor(
  division: LeagueDivision | null,
  level: number | null
): number | null {
  switch (division) {
    case "adult_18":
      // 2.5 (women) and 5.0 teams only need 5; standard levels need 8.
      return level != null && (level <= 2.5 || level >= 5.0) ? 5 : 8;
    case "adult_40":
      return 9;
    case "adult_55":
    case "adult_65":
      return 6;
    case "mixed_18":
    case "mixed_40":
      return 6;
    default:
      return null;
  }
}
