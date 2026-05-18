import { NextRequest, NextResponse } from "next/server";
import { CURATED_REGIONS, type BBox, type CuratedCourt } from "@/lib/courts-data";
import {
  filterFacilitiesByBbox,
  descriptionPreview,
  type Facility,
  type ManagedByBucket,
} from "@/lib/facilities";

// ── Types ───────────────────────────────────────────────────────────
type CourtResult = {
  id: string;
  type: string;
  osmId: number;
  lat: number;
  lng: number;
  name: string;
  surface?: string;
  access?: string;
  lit?: boolean;
  courts?: number;
  address?: string;
  source: "official" | "osm" | "facility";
  /** Only present on facility results. Drives marker color on the map. */
  bucket?: ManagedByBucket;
  bookingUrl?: string | null;
  category?: Facility["category"];
  status?: Facility["status"];
  descriptionPreview?: string | null;
};

// Wrap a CuratedCourt into the API shape
function curatedToResult(c: CuratedCourt): CourtResult {
  return {
    id: c.id,
    type: "official",
    osmId: 0,
    lat: c.lat,
    lng: c.lng,
    name: c.name,
    surface: c.surface,
    lit: c.lit,
    courts: c.courts,
    address: c.address,
    source: "official",
  };
}

function facilityToResult(f: Facility): CourtResult {
  // Caller already filtered to facilities with lat/lng populated, but the
  // type is still nullable.
  return {
    id: f.courtId,
    type: "facility",
    osmId: 0,
    lat: f.latitude!,
    lng: f.longitude!,
    name: f.name,
    surface: f.indoorOutdoor === "indoor" ? "indoor" : undefined,
    lit: f.lighted ?? undefined,
    courts: f.courtCount ?? undefined,
    address: f.address,
    source: "facility",
    bucket: f.bucket,
    // Suppress the card's "Book" button when the venue is info-only
    // (`bookable: false`) OR has multiple per-court booking links (the card
    // can't show >1 button — direct the user to Details). Detail page still
    // gets the URL from /api/courts/[id].
    bookingUrl: f.bookable && !f.bookingLinks ? f.bookingUrl : null,
    category: f.category,
    status: f.status,
    descriptionPreview: descriptionPreview(f.description),
  };
}

// ── Bounds helpers ──────────────────────────────────────────────────
function boundsOverlap(a: BBox, b: BBox): boolean {
  return a.south < b.north && a.north > b.south && a.west < b.east && a.east > b.west;
}

function boundsContains(outer: BBox, inner: BBox): boolean {
  return inner.south >= outer.south && inner.north <= outer.north &&
         inner.west >= outer.west && inner.east <= outer.east;
}

function pointInsideAnyCuratedBbox(lat: number, lng: number): boolean {
  for (const region of CURATED_REGIONS) {
    // Only regions with suppressOsm !== false block OSM. Additive regions
    // (like WA Puget Sound) let OSM through in their gaps; near-duplicates
    // are filtered by proximity dedup later.
    if (region.suppressOsm === false) continue;
    const b = region.bbox;
    if (lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east) {
      return true;
    }
  }
  return false;
}

// Haversine approximation in meters. Cheap enough to call in a tight loop for
// the handful of OSM results we're deduping against curated markers.
function metersBetween(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── In-memory cache for Overpass (non-curated areas) ────────────────
type CachedCell = { courts: CourtResult[]; fetchedAt: number };
const cache = new Map<string, CachedCell>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const GRID_SIZE = 0.1; // ~11 km cells

function snap(v: number, floor: boolean): number {
  return floor
    ? Math.floor(v / GRID_SIZE) * GRID_SIZE
    : Math.ceil(v / GRID_SIZE) * GRID_SIZE;
}

function cellKey(s: number, w: number): string {
  return `${s.toFixed(2)},${w.toFixed(2)}`;
}

// Multiple Overpass API endpoints — the public overpass-api.de server is
// often overloaded and returns 502/504; the Kumi mirror is generally more
// reliable. Try them in order, falling back on failure.
const OVERPASS_MIRRORS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];

async function fetchOverpass(
  south: number,
  west: number,
  north: number,
  east: number
): Promise<CourtResult[]> {
  const query = `[out:json][timeout:25];
(
  node["leisure"="pitch"]["sport"="tennis"](${south},${west},${north},${east});
  way["leisure"="pitch"]["sport"="tennis"](${south},${west},${north},${east});
);
out center tags;`;
  const body = "data=" + encodeURIComponent(query);

  // Try each mirror. Overpass sometimes returns HTTP 200 with an HTML error
  // page ("server is probably too busy"), so we verify the response is
  // actually JSON before accepting it.
  let lastErr: unknown = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any = null;
  for (const url of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) {
        lastErr = new Error(`Overpass ${url} → ${res.status}`);
        continue;
      }
      const text = await res.text();
      // Overpass error pages start with "<?xml" or "<!DOCTYPE html"
      if (text.startsWith("<")) {
        lastErr = new Error(`Overpass ${url} → HTML error response`);
        continue;
      }
      json = JSON.parse(text);
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!json) {
    throw lastErr instanceof Error ? lastErr : new Error("Overpass: all mirrors failed");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const elements: any[] = Array.isArray(json.elements) ? json.elements : [];
  const out: CourtResult[] = [];
  for (const el of elements) {
    const lat = typeof el.lat === "number" ? el.lat : el.center?.lat;
    const lng = typeof el.lon === "number" ? el.lon : el.center?.lon;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    // Skip courts that fall inside ANY curated region's bbox — our hand
    // curated lists are more accurate than OSM, so we don't want duplicates
    // or lower-quality OSM markers layered on top of the good data.
    if (pointInsideAnyCuratedBbox(lat, lng)) continue;
    const tags = el.tags || {};
    out.push({
      id: `${el.type}/${el.id}`,
      type: el.type,
      osmId: el.id,
      lat,
      lng,
      name: tags.name || "Tennis court",
      surface: tags.surface,
      access: tags.access,
      lit: tags.lit === "yes",
      source: "osm",
    });
  }
  return out;
}

// GET /api/courts?south=..&west=..&north=..&east=..
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const south = parseFloat(sp.get("south") || "");
  const west = parseFloat(sp.get("west") || "");
  const north = parseFloat(sp.get("north") || "");
  const east = parseFloat(sp.get("east") || "");

  if ([south, west, north, east].some((v) => isNaN(v))) {
    return NextResponse.json(
      { error: "south, west, north, east query params required" },
      { status: 400 }
    );
  }

  const requestBounds: BBox = { south, west, north, east };
  const allCourts: CourtResult[] = [];

  // 1. Add curated courts from every region whose bbox overlaps the viewport
  for (const region of CURATED_REGIONS) {
    if (!boundsOverlap(requestBounds, region.bbox)) continue;
    for (const c of region.courts) {
      if (c.lat >= south && c.lat <= north && c.lng >= west && c.lng <= east) {
        allCourts.push(curatedToResult(c));
      }
    }
  }

  // 1b. Inject scraped facilities (data/tennis_courts_geocoded.json, ~267
  // venues across King/Pierce/Snohomish/Kitsap counties). The lib filters
  // by viewport, so calling it on every request is cheap. This supersedes
  // the old hand-curated SEATTLE_COURTS / EASTSIDE_COURTS / WA_PUGET_SOUND
  // arrays for Greater Seattle — those regional entries in CURATED_REGIONS
  // are intentionally empty now and only contribute their bboxes for OSM
  // suppression.
  for (const f of filterFacilitiesByBbox(requestBounds)) {
    allCourts.push(facilityToResult(f));
  }

  // 2. If viewport is entirely within a single curated region that claims
  //    comprehensive coverage (suppressOsm !== false), skip Overpass — the
  //    curated data is authoritative and OSM would just add noise.
  //    Additive regions (wa-puget-sound) still need OSM for gap fill-in.
  const needOverpass = !CURATED_REGIONS.some((r) =>
    r.suppressOsm !== false && boundsContains(r.bbox, requestBounds)
  );

  if (needOverpass) {
    // Snap bounds outward to grid cells
    const gSouth = snap(south, true);
    const gWest = snap(west, true);
    const gNorth = snap(north, false);
    const gEast = snap(east, false);

    const now = Date.now();
    const cellsToFetch: { s: number; w: number; n: number; e: number; key: string }[] = [];

    for (let s = gSouth; s < gNorth; s = parseFloat((s + GRID_SIZE).toFixed(4))) {
      for (let w = gWest; w < gEast; w = parseFloat((w + GRID_SIZE).toFixed(4))) {
        const key = cellKey(s, w);
        const cached = cache.get(key);
        if (cached && now - cached.fetchedAt < CACHE_TTL) {
          allCourts.push(...cached.courts);
        } else {
          cellsToFetch.push({
            s, w,
            n: parseFloat((s + GRID_SIZE).toFixed(4)),
            e: parseFloat((w + GRID_SIZE).toFixed(4)),
            key,
          });
        }
      }
    }

    const maxCells = 12;
    if (cellsToFetch.length > maxCells) {
      cellsToFetch.length = maxCells;
    }

    if (cellsToFetch.length > 0) {
      const batchSouth = Math.min(...cellsToFetch.map((c) => c.s));
      const batchWest = Math.min(...cellsToFetch.map((c) => c.w));
      const batchNorth = Math.max(...cellsToFetch.map((c) => c.n));
      const batchEast = Math.max(...cellsToFetch.map((c) => c.e));

      try {
        const results = await fetchOverpass(batchSouth, batchWest, batchNorth, batchEast);
        for (const cell of cellsToFetch) {
          const cellCourts = results.filter(
            (c) => c.lat >= cell.s && c.lat < cell.n && c.lng >= cell.w && c.lng < cell.e
          );
          cache.set(cell.key, { courts: cellCourts, fetchedAt: now });
        }
        allCourts.push(...results);
      } catch {
        if (allCourts.length === 0) {
          return NextResponse.json(
            { error: "Failed to fetch courts" },
            { status: 502 }
          );
        }
      }
    }
  }

  // Deduplicate by id
  const seen = new Set<string>();
  const unique = allCourts.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  // Proximity dedup: drop any OSM marker within 80m of a curated/facility
  // marker. Handles overlap between additive regions (like WA Puget Sound)
  // or scraped facilities and OSM-tagged duplicates of the same park.
  const PROXIMITY_M = 80;
  const authoritative = unique.filter(
    (c) => c.source === "official" || c.source === "facility"
  );
  const osm = unique.filter((c) => c.source === "osm");
  const filteredOsm = osm.filter((o) => {
    for (const c of authoritative) {
      if (metersBetween(o.lat, o.lng, c.lat, c.lng) < PROXIMITY_M) return false;
    }
    return true;
  });

  return NextResponse.json([...authoritative, ...filteredOsm]);
}
