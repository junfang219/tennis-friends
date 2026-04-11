import { NextRequest, NextResponse } from "next/server";

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
  source: "official" | "osm";
};

// ── Seattle official court data (City of Seattle ArcGIS) ────────────
const SEATTLE_BBOX = { south: 47.48, west: -122.46, north: 47.78, east: -122.22 };

const SEATTLE_COURTS: CourtResult[] = [
  { id: "sea-1",  name: "Madrona Playground",           lat: 47.6114, lng: -122.2901, courts: 2,  address: "3211 E Spring St" },
  { id: "sea-2",  name: "Ravenna Park",                 lat: 47.6694, lng: -122.3029, courts: 2,  address: "5520 Ravenna Ave NE" },
  { id: "sea-3",  name: "Solstice Park",                lat: 47.5365, lng: -122.3917, courts: 6,  address: "7400 Fauntleroy Way SW" },
  { id: "sea-4",  name: "Hiawatha Playfield",           lat: 47.5790, lng: -122.3852, courts: 3,  address: "2700 California Ave SW" },
  { id: "sea-5",  name: "Madison Park",                 lat: 47.6349, lng: -122.2781, courts: 2,  address: "E Madison St / E Howe St" },
  { id: "sea-6",  name: "Magnolia Park",                lat: 47.6356, lng: -122.3975, courts: 2,  address: "1461 Magnolia Blvd W" },
  { id: "sea-7",  name: "Kinnear Park",                 lat: 47.6263, lng: -122.3649, courts: 1,  address: "899 W Olympic Pl" },
  { id: "sea-8",  name: "Rogers Playground",             lat: 47.6429, lng: -122.3254, courts: 2,  address: "Eastlake Ave E / E Roanoke St" },
  { id: "sea-9",  name: "Pendleton Miller Playfield",   lat: 47.6208, lng: -122.3070, courts: 2,  address: "330 19th Ave E" },
  { id: "sea-10", name: "Seward Park",                  lat: 47.5482, lng: -122.2576, courts: 2,  address: "5898 Lake Washington Blvd S" },
  { id: "sea-11", name: "West Magnolia Playfield",      lat: 47.6410, lng: -122.4003, courts: 4,  address: "2518 34th Ave W" },
  { id: "sea-12", name: "Wallingford Playfield",        lat: 47.6584, lng: -122.3365, courts: 2,  address: "4219 Wallingford Ave N" },
  { id: "sea-13", name: "Bitter Lake Playfield",        lat: 47.7235, lng: -122.3498, courts: 4,  address: "13035 Linden Ave N" },
  { id: "sea-14", name: "Brighton Playfield",           lat: 47.5479, lng: -122.2829, courts: 2,  address: "6000 39th Ave S" },
  { id: "sea-15", name: "Sam Smith Park",               lat: 47.5900, lng: -122.2961, courts: 2,  address: "1400 Martin Luther King Jr Way S" },
  { id: "sea-16", name: "Fred Hutchinson Playground",   lat: 47.5149, lng: -122.2604, courts: 2,  address: "S Norfolk St / 59th Ave S" },
  { id: "sea-17", name: "Montlake Playfield",           lat: 47.6414, lng: -122.3104, courts: 2,  address: "6118 E Calhoun St" },
  { id: "sea-18", name: "Mount Baker Park",             lat: 47.5796, lng: -122.2885, courts: 2,  address: "2521 Lake Park Dr S" },
  { id: "sea-19", name: "Rainier Beach Playfield",      lat: 47.5240, lng: -122.2735, courts: 4,  address: "8802 Rainier Ave S" },
  { id: "sea-20", name: "Highland Park Playground",     lat: 47.5268, lng: -122.3498, courts: 1,  address: "1100 SW Cloverdale St" },
  { id: "sea-21", name: "Discovery Park",               lat: 47.6568, lng: -122.4048, courts: 2,  address: "3801 W Government Way" },
  { id: "sea-22", name: "Warren G. Magnuson Park",      lat: 47.6814, lng: -122.2523, courts: 6,  address: "7400 Sand Point Way NE" },
  { id: "sea-23", name: "Victory Heights Playground",   lat: 47.7059, lng: -122.3082, courts: 1,  address: "1737 NE 106th St" },
  { id: "sea-24", name: "Green Lake Park (East)",       lat: 47.6815, lng: -122.3284, courts: 3,  address: "7201 E Green Lake Dr N" },
  { id: "sea-25", name: "Alki Playground",              lat: 47.5792, lng: -122.4077, courts: 2,  address: "5817 SW Lander St" },
  { id: "sea-26", name: "David Rodgers Park",           lat: 47.6448, lng: -122.3587, courts: 3,  address: "2800 1st Ave W" },
  { id: "sea-27", name: "Leschi Park",                  lat: 47.6014, lng: -122.2877, courts: 1,  address: "201 Lakeside Ave S" },
  { id: "sea-28", name: "Garfield Playfield",           lat: 47.6077, lng: -122.3003, courts: 2,  address: "23rd Ave / E Cherry St" },
  { id: "sea-29", name: "Ravenna-Eckstein Park",        lat: 47.6764, lng: -122.3048, courts: 1,  address: "6535 Ravenna Ave NE" },
  { id: "sea-30", name: "Beacon Hill Playground",       lat: 47.5868, lng: -122.3156, courts: 2,  address: "1902 13th Ave S" },
  { id: "sea-31", name: "Laurelhurst Playfield",        lat: 47.6592, lng: -122.2789, courts: 4,  address: "4544 NE 41st St" },
  { id: "sea-32", name: "Delridge Playfield",           lat: 47.5633, lng: -122.3649, courts: 2,  address: "4458 Delridge Way SW" },
  { id: "sea-33", name: "University Playground",        lat: 47.6647, lng: -122.3199, courts: 2,  address: "9th Ave NE / NE 50th St" },
  { id: "sea-34", name: "Bryant Neighborhood Playground", lat: 47.6751, lng: -122.2840, courts: 2, address: "4103 NE 65th St" },
  { id: "sea-35", name: "Froula Playground",            lat: 47.6806, lng: -122.3153, courts: 2,  address: "7200 12th Ave NE" },
  { id: "sea-36", name: "Walt Hundley Playfield",       lat: 47.5403, lng: -122.3747, courts: 2,  address: "6920 34th Ave SW" },
  { id: "sea-37", name: "Jefferson Park",               lat: 47.5701, lng: -122.3082, courts: 4,  address: "4165 16th Ave S" },
  { id: "sea-38", name: "South Park Playground",        lat: 47.5284, lng: -122.3252, courts: 1,  address: "738 S Sullivan St" },
  { id: "sea-39", name: "Riverview Playfield",          lat: 47.5400, lng: -122.3499, courts: 2,  address: "7226 12th Ave SW" },
  { id: "sea-40", name: "Georgetown Playfield",         lat: 47.5524, lng: -122.3221, courts: 1,  address: "750 S Homer St" },
  { id: "sea-41", name: "Gilman Playground",            lat: 47.6670, lng: -122.3702, courts: 2,  address: "923 NW 54th St" },
  { id: "sea-42", name: "Rainier Playfield",            lat: 47.5625, lng: -122.2869, courts: 4,  address: "3700 S Alaska St" },
  { id: "sea-43", name: "Soundview Playfield",          lat: 47.6959, lng: -122.3805, courts: 2,  address: "1590 NW 90th St" },
  { id: "sea-44", name: "Volunteer Park (Lower)",       lat: 47.6317, lng: -122.3175, courts: 2,  address: "1247 15th Ave E" },
  { id: "sea-45", name: "Woodland Park (Upper)",        lat: 47.6642, lng: -122.3435, courts: 4,  address: "Aurora Ave N / N 59th St" },
  { id: "sea-46", name: "Amy Yee Tennis Center",        lat: 47.5852, lng: -122.2976, courts: 6,  address: "2000 Martin Luther King Jr. Way S" },
  { id: "sea-47", name: "Dearborn Park",                lat: 47.5522, lng: -122.2951, courts: 2,  address: "9219 S Brandon St" },
  { id: "sea-48", name: "Observatory Courts",           lat: 47.6316, lng: -122.3551, courts: 2,  address: "1405 Warren Ave N" },
  { id: "sea-49", name: "Woodland Park (Lower)",        lat: 47.6693, lng: -122.3433, courts: 10, address: "1000 N 50th St" },
  { id: "sea-50", name: "Cal Anderson Park",            lat: 47.6158, lng: -122.3199, courts: 1,  address: "1635 11th Ave" },
  { id: "sea-51", name: "Green Lake Park (West)",       lat: 47.6812, lng: -122.3426, courts: 2,  address: "Green Lake Trail" },
  { id: "sea-52", name: "Volunteer Park (Upper)",       lat: 47.6320, lng: -122.3180, courts: 2,  address: "1247 15th Ave E" },
  { id: "sea-53", name: "Meadowbrook Playfield",        lat: 47.7062, lng: -122.2955, courts: 6,  address: "10533 35th Ave NE" },
].map((c) => ({ ...c, type: "official", osmId: 0, source: "official" as const }));

// ── In-memory cache for Overpass (non-Seattle areas) ────────────────
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

function boundsOverlap(
  a: { south: number; west: number; north: number; east: number },
  b: { south: number; west: number; north: number; east: number }
): boolean {
  return a.south < b.north && a.north > b.south && a.west < b.east && a.east > b.west;
}

function boundsContains(
  outer: { south: number; west: number; north: number; east: number },
  inner: { south: number; west: number; north: number; east: number }
): boolean {
  return inner.south >= outer.south && inner.north <= outer.north &&
         inner.west >= outer.west && inner.east <= outer.east;
}

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
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const json = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const elements: any[] = Array.isArray(json.elements) ? json.elements : [];
  const out: CourtResult[] = [];
  for (const el of elements) {
    const lat = typeof el.lat === "number" ? el.lat : el.center?.lat;
    const lng = typeof el.lon === "number" ? el.lon : el.center?.lon;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    // Skip courts that fall inside Seattle bbox (official data is better)
    if (lat >= SEATTLE_BBOX.south && lat <= SEATTLE_BBOX.north &&
        lng >= SEATTLE_BBOX.west && lng <= SEATTLE_BBOX.east) {
      continue;
    }
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

  const requestBounds = { south, west, north, east };
  const allCourts: CourtResult[] = [];

  // 1. Add Seattle official courts if viewport overlaps Seattle
  if (boundsOverlap(requestBounds, SEATTLE_BBOX)) {
    const seattleInView = SEATTLE_COURTS.filter(
      (c) => c.lat >= south && c.lat <= north && c.lng >= west && c.lng <= east
    );
    allCourts.push(...seattleInView);
  }

  // 2. If viewport is entirely within Seattle, skip Overpass entirely
  const needOverpass = !boundsContains(SEATTLE_BBOX, requestBounds);

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

  return NextResponse.json(unique);
}
