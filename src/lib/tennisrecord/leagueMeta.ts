// Maps a tennisrecord team-search result to a prefilled USTA league draft +
// season name for the create-team wizard. Pure and best-effort: anything we
// can't infer stays blank and the captain edits it in the form.

import { defaultRatingScheme, levelOptions, type LeagueDivision } from "@/lib/leagueFormats";
import { emptyLeagueDraft, type LeagueDraft } from "@/lib/leagueDraft";

// tennisrecord leagueType strings (see searchOptions.SEARCH_LEAGUE_TYPES) →
// our division values. Types without a matching division ("Adult 70+",
// "Flex Format", "* Other") fall back to "other".
const DIVISION_BY_LEAGUE_TYPE: Record<string, LeagueDivision> = {
  "Adult 18+": "adult_18",
  "Adult 18-39": "adult_18",
  "Adult 40+": "adult_40",
  "Adult 55+": "adult_55",
  "Adult 65+": "adult_65",
  "Mixed 18+": "mixed_18",
  "Mixed 40+": "mixed_40",
  Combo: "combo",
  "Tri-Level 18+": "tri_level",
  "Tri-Level 40+": "tri_level",
  "Tri-Level 55+": "tri_level",
};

// Suggested lineup-format preset per division (PNW-flavored defaults — the
// captain can change it): 18&O standard levels play 2S+3D but 2.5/5.0 play
// 1S+2D; 40&O plays 1S+3D in PNW local play; 55/65&O and Mixed play 3D.
function suggestedFormatId(division: LeagueDivision | "", level: number | null): string {
  switch (division) {
    case "adult_18":
      return level != null && (level <= 2.5 || level >= 5.0) ? "1s2d" : "2s3d";
    case "adult_40":
      return "1s3d";
    case "adult_55":
    case "adult_65":
    case "mixed_18":
    case "mixed_40":
      return "3d";
    default:
      return "";
  }
}

export function leagueDraftFromSearchResult(
  r: { leagueType: string; ntrp: number | null },
  year?: string
): { draft: LeagueDraft; seasonName: string } {
  const division = DIVISION_BY_LEAGUE_TYPE[r.leagueType] ?? (r.leagueType ? "other" : "");
  const scheme = division ? defaultRatingScheme(division) : "straight";
  // Only adopt the level when it fits the scheme's option list — e.g. a 3.5
  // straight rating on a combined-scheme division would render as an invalid
  // select value, so we leave it for the captain instead.
  const level = r.ntrp != null && levelOptions(scheme).includes(r.ntrp) ? r.ntrp : null;
  const draft: LeagueDraft = {
    ...emptyLeagueDraft(),
    division,
    scheme,
    level: level != null ? String(level) : "",
    formatId: division ? suggestedFormatId(division, level) : "",
  };
  const seasonName = [year, r.leagueType].filter(Boolean).join(" ").trim() || "USTA season";
  return { draft, seasonName };
}
