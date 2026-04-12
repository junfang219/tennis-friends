/**
 * Shared types for hand-curated tennis court data.
 *
 * Each regional file in this directory exports a BBOX and a COURTS array.
 * The `index.ts` barrel file composes them into CURATED_REGIONS, which
 * `src/app/api/courts/route.ts` iterates to filter the map viewport and
 * suppress OpenStreetMap (Overpass) fallback results inside curated areas.
 */

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * Raw curated court entry used in the per-city files. Matches the shape of
 * the Seattle data before it gets wrapped with `type`, `osmId`, and `source`
 * for the API response.
 */
export interface CuratedCourt {
  id: string;
  name: string;
  lat: number;
  lng: number;
  courts: number;
  address: string;
  surface?: string;
  lit?: boolean;
}

export interface CuratedRegion {
  /** Short slug used for dedup keys and log output. */
  key: string;
  /** Human-readable label, e.g. "Seattle", "Bay Area". */
  label: string;
  bbox: BBox;
  courts: CuratedCourt[];
  /**
   * When true (default), OpenStreetMap (Overpass) results inside this
   * region's bbox are suppressed — the curated list is assumed to be
   * comprehensive. Set to false for "additive" regions where the curated
   * data covers only some of the cities in the bbox and OSM should still
   * fill in gaps. Proximity-dedup in route.ts will still drop any OSM
   * marker within ~80m of a curated marker to avoid visible duplicates.
   */
  suppressOsm?: boolean;
}
