/**
 * Seattle Eastside bbox — Bellevue, Redmond, Kirkland, Issaquah, Sammamish,
 * Mercer Island.
 *
 * The previous hand-curated `EASTSIDE_COURTS` array (Bellevue Parks, Issaquah
 * Parks, etc.) is now superseded by the 268-venue scraped facility dataset
 * (`src/lib/facilities.ts` → `data/tennis_courts_geocoded.json`). That dataset
 * covers all of King + Pierce + Snohomish + Kitsap counties, so the Eastside
 * area is fully represented there.
 *
 * The bbox stays exported (and registered in `CURATED_REGIONS` with an empty
 * `courts` array) so that `pointInsideAnyCuratedBbox` continues to suppress
 * Overpass/OSM markers in this area — the facility dataset is authoritative.
 */

import type { BBox, CuratedCourt } from "./types";

export const EASTSIDE_BBOX: BBox = {
  south: 47.50,
  west: -122.25,
  north: 47.75,
  east: -121.96,
};

export const EASTSIDE_COURTS: CuratedCourt[] = [];
