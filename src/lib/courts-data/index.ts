/**
 * Barrel file that composes every hand-curated tennis court region into
 * a single CURATED_REGIONS array.
 *
 * `src/app/api/courts/route.ts` imports this to:
 *   1. Filter curated courts by the map viewport
 *   2. Skip the Overpass (OpenStreetMap) fallback inside curated bboxes
 *      so their less-accurate data doesn't overlap with our clean lists
 *
 * To add a new region:
 *   1. Create `./<slug>.ts` that exports `<SLUG>_BBOX` and `<SLUG>_COURTS`
 *   2. Import and append here
 */

import type { CuratedRegion } from "./types";
import { SEATTLE_BBOX, SEATTLE_COURTS } from "./seattle";
import { BAY_AREA_BBOX, BAY_AREA_COURTS } from "./bay-area";
import { EASTSIDE_BBOX, EASTSIDE_COURTS } from "./eastside";
import { LOS_ANGELES_BBOX, LOS_ANGELES_COURTS } from "./los-angeles";
import { NYC_BBOX, NYC_COURTS } from "./nyc";
import { WA_PUGET_SOUND_BBOX, WA_PUGET_SOUND_COURTS } from "./wa-puget-sound";
import { PDX_METRO_BBOX, PDX_METRO_COURTS } from "./portland";
import { CHICAGO_METRO_BBOX, CHICAGO_METRO_COURTS } from "./chicago";
import { SOCAL_EXTENDED_BBOX, SOCAL_EXTENDED_COURTS } from "./socal-extended";

// NOTE: order matters for the iteration in `src/app/api/courts/route.ts`.
// More specific regions (Seattle, Eastside) are listed BEFORE the broader
// wa-puget-sound region so that within the overlap area, the more curated
// list is iterated first. (In practice, each court belongs to exactly one
// region's courts array, so order only affects which bbox the OSM-skip
// logic considers first — but it's still good hygiene to go narrow→broad.)
export const CURATED_REGIONS: CuratedRegion[] = [
  { key: "seattle",        label: "Seattle",           bbox: SEATTLE_BBOX,        courts: SEATTLE_COURTS },
  { key: "eastside",       label: "Seattle Eastside",  bbox: EASTSIDE_BBOX,       courts: EASTSIDE_COURTS },
  { key: "wa-puget-sound", label: "WA Puget Sound",    bbox: WA_PUGET_SOUND_BBOX, courts: WA_PUGET_SOUND_COURTS },
  { key: "bay-area",       label: "SF Bay Area",       bbox: BAY_AREA_BBOX,       courts: BAY_AREA_COURTS },
  { key: "los-angeles",    label: "Los Angeles",       bbox: LOS_ANGELES_BBOX,    courts: LOS_ANGELES_COURTS },
  { key: "socal-extended", label: "SoCal Extended",    bbox: SOCAL_EXTENDED_BBOX, courts: SOCAL_EXTENDED_COURTS },
  { key: "nyc",            label: "New York City",     bbox: NYC_BBOX,            courts: NYC_COURTS },
  { key: "portland",       label: "Portland Metro",    bbox: PDX_METRO_BBOX,      courts: PDX_METRO_COURTS },
  { key: "chicago",        label: "Chicago Metro",     bbox: CHICAGO_METRO_BBOX,  courts: CHICAGO_METRO_COURTS },
];

export type { BBox, CuratedCourt, CuratedRegion } from "./types";
