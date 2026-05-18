/**
 * Seattle bbox — used by `src/app/api/courts/route.ts` to decide when to
 * source data from the new scraped facility dataset (`src/lib/facilities.ts`,
 * backed by `data/tennis_courts_geocoded.json`) instead of an inline curated
 * array.
 *
 * Prior to the dataset switchover this file also exported a 53-venue
 * hardcoded `SEATTLE_COURTS` array. Those venues are now superseded by the
 * 268-venue scraped dataset (Seattle + surrounding counties). The old `sea-N`
 * IDs are no longer rendered on the map; new IDs are `tf-{externalId}`.
 */

import type { BBox } from "./types";

export const SEATTLE_BBOX: BBox = {
  south: 47.48,
  west: -122.46,
  north: 47.78,
  east: -122.22,
};
