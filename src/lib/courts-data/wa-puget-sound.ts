/**
 * Washington State — Puget Sound bbox (Snohomish, north King, Pierce, Kitsap).
 *
 * The previous hand-curated `WA_PUGET_SOUND_COURTS` array (derived from
 * Overpass) is now superseded by the 268-venue scraped facility dataset
 * (`src/lib/facilities.ts` → `data/tennis_courts_geocoded.json`), which
 * covers the same counties with verified addresses, phones, and booking URLs.
 *
 * The bbox stays exported (and registered in `CURATED_REGIONS` with an empty
 * `courts` array) so that `pointInsideAnyCuratedBbox` continues to suppress
 * Overpass/OSM markers across this area — the facility dataset is the
 * authoritative source.
 */

import type { BBox, CuratedCourt } from "./types";

export const WA_PUGET_SOUND_BBOX: BBox = {
  south: 47.10,
  west: -122.80,
  north: 48.10,
  east: -121.95,
};

export const WA_PUGET_SOUND_COURTS: CuratedCourt[] = [];
