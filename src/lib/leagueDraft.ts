// Pure draft model for the USTA league fields form (LeagueFields component).
// Holds the strings/ids the inputs bind to; draftToColumns converts to the
// seasons.* column payload. Kept out of the component file so pure code
// (leagueMeta prefill, tests) can import it without JSX.

import {
  LINEUP_PRESETS,
  buildSlots,
  defaultRatingScheme,
  type LeagueDivision,
  type LineupSlotDef,
  type RatingScheme,
} from "@/lib/leagueFormats";
import type { Json } from "@/lib/database.types";

export type LeagueDraft = {
  division: "" | LeagueDivision;
  scheme: RatingScheme;
  level: string; // select value; "" = unset
  flight: string;
  ustaTeamNumber: string;
  formatId: string; // "" = none, a LINEUP_PRESETS id, or "custom"
  customSingles: number;
  customDoubles: number;
};

export const emptyLeagueDraft = (): LeagueDraft => ({
  division: "",
  scheme: "straight",
  level: "",
  flight: "",
  ustaTeamNumber: "",
  formatId: "",
  customSingles: 1,
  customDoubles: 3,
});

export function draftFormat(d: LeagueDraft): LineupSlotDef[] | null {
  if (!d.formatId) return null;
  if (d.formatId === "custom") {
    const s = buildSlots(d.customSingles, d.customDoubles);
    return s.length > 0 ? s : null;
  }
  return LINEUP_PRESETS.find((p) => p.id === d.formatId)?.slots ?? null;
}

export function draftToColumns(d: LeagueDraft) {
  return {
    league_division: d.division || null,
    rating_scheme: d.division ? d.scheme : null,
    league_level: d.level ? Number(d.level) : null,
    flight: d.flight.trim() || null,
    usta_team_number: d.ustaTeamNumber.trim() || null,
    lineup_format: draftFormat(d) as unknown as Json,
  };
}

// Reverse of draftToColumns for the per-season editor (camel season shape).
export function draftFromSeason(s: {
  division: LeagueDivision | null;
  ratingScheme: RatingScheme | null;
  level: number | null;
  flight: string | null;
  ustaTeamNumber: string | null;
  lineupFormat: LineupSlotDef[] | null;
}): LeagueDraft {
  const fmt = s.lineupFormat;
  let formatId = "";
  let customSingles = 1;
  let customDoubles = 3;
  if (fmt) {
    const preset = LINEUP_PRESETS.find(
      (p) =>
        p.slots.length === fmt.length &&
        p.slots.every((sl, i) => sl.code === fmt[i].code && sl.type === fmt[i].type)
    );
    if (preset) {
      formatId = preset.id;
    } else {
      formatId = "custom";
      customSingles = fmt.filter((x) => x.type === "singles").length;
      customDoubles = fmt.filter((x) => x.type === "doubles").length;
    }
  }
  return {
    division: s.division ?? "",
    scheme: s.ratingScheme ?? (s.division ? defaultRatingScheme(s.division) : "straight"),
    level: s.level != null ? String(s.level) : "",
    flight: s.flight ?? "",
    ustaTeamNumber: s.ustaTeamNumber ?? "",
    formatId,
    customSingles,
    customDoubles,
  };
}
