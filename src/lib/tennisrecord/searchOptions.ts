// Dropdown option values for the tennisrecord team search, kept identical to
// teamsearch.aspx's own <select> values — the POST must send these EXACT
// strings (e.g. section is "Pacific NW", not "NW"). Shared by the search UI
// and validated server-side. If tennisrecord changes its options, update here.

// The site lists years from next season (registration opens before the
// calendar year starts) back to 2014. Generated so the list rolls forward
// on its own each season.
const FIRST_SEARCH_YEAR = 2014;
const LATEST_SEARCH_YEAR = new Date().getFullYear() + 1;

export const SEARCH_YEARS: string[] = Array.from(
  { length: LATEST_SEARCH_YEAR - FIRST_SEARCH_YEAR + 1 },
  (_, i) => String(LATEST_SEARCH_YEAR - i),
);

// Value "" means "All". Labels mirror the site.
export const SEARCH_LEAGUE_TYPES: { value: string; label: string }[] = [
  { value: "", label: "All league types" },
  { value: "Adult 18+", label: "Adult 18+" },
  { value: "Adult 40+", label: "Adult 40+" },
  { value: "Adult 55+", label: "Adult 55+" },
  { value: "Adult 65+", label: "Adult 65+" },
  { value: "Adult 70+", label: "Adult 70+" },
  { value: "Adult Other", label: "Adult Other" },
  { value: "Combo", label: "Combo" },
  { value: "Mixed 18+", label: "Mixed 18+" },
  { value: "Mixed 40+", label: "Mixed 40+" },
  { value: "Mixed Other", label: "Mixed Other" },
  { value: "Tri-Level 18+", label: "Tri-Level 18+" },
  { value: "Tri-Level 40+", label: "Tri-Level 40+" },
  { value: "Tri-Level 55+", label: "Tri-Level 55+" },
  { value: "Flex Format", label: "Flex Format" },
  { value: "Adult 18-39", label: "Adult 18-39" },
];

// Value "" means "All". The app is Seattle-focused, so "Pacific NW" is the
// sensible default selection in the UI.
export const SEARCH_SECTIONS: string[] = [
  "Caribbean", "Eastern", "Florida", "Foreign", "Hawaii", "Intermountain",
  "Mid-Atlantic", "Middle States", "Midwest", "Missouri Valley", "New England",
  "No California", "Northern", "Pacific NW", "So California", "Southern",
  "Southwest", "Texas",
];

export const DEFAULT_SECTION = "Pacific NW";
export const DEFAULT_YEAR = String(new Date().getFullYear());

const LEAGUE_TYPE_VALUES = new Set(SEARCH_LEAGUE_TYPES.map((o) => o.value));
const SECTION_VALUES = new Set(["", ...SEARCH_SECTIONS]);
const YEAR_VALUES = new Set<string>(SEARCH_YEARS);

export const isValidYear = (v: string) => YEAR_VALUES.has(v);
export const isValidSection = (v: string) => SECTION_VALUES.has(v);
export const isValidLeagueType = (v: string) => LEAGUE_TYPE_VALUES.has(v);
