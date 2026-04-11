/**
 * ActiveNet REST API client for Seattle Parks tennis courts.
 *
 * Uses the unauthenticated internal REST API at:
 *   POST /seattle/rest/reservation/resource — lists bookable courts
 *   GET  /seattle/rest/reservation/resource/detail/{id} — court details
 *
 * NOTE: Time-slot availability requires user authentication.
 * When API credentials are available (ACTIVENET_API_KEY, ACTIVENET_SHARED_SECRET),
 * add a fetchTimeslots() function using the GetFacilitySchedules endpoint.
 */

const BASE_URL = "https://anc.apm.activecommunities.com/seattle/rest";
const TENNIS_OUTDOOR_TYPE_ID = 39;
const TENNIS_INDOOR_TYPE_ID = 115;
const TENNIS_EVENT_TYPE_ID = 152;

// ── Types ───────────────────────────────────────────────────────────

export interface ActiveNetCourt {
  id: number; // ActiveNet resource ID
  name: string;
  centerName: string;
  centerId: number;
  typeName: string;
  capacity: number;
  bookableOnline: boolean; // !no_internet_permits
  reserveBy: string; // "minute"
}

export interface ActiveNetCourtDetail {
  id: number;
  name: string;
  centerName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  description: string;
  minTime: number; // minutes
  maxTime: number; // minutes
  maxCapacity: number;
  openingHours: Array<{
    dateRange: string;
    daysOfWeek: string;
    openingTimes: string;
  }>;
  amenities: Array<{ name: string }>;
  restrictions: string[];
}

// ── Cache ───────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const courtListCache: { entry: CacheEntry<ActiveNetCourt[]> | null } = {
  entry: null,
};
const detailCache = new Map<number, CacheEntry<ActiveNetCourtDetail>>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function isFresh<T>(entry: CacheEntry<T> | null | undefined): entry is CacheEntry<T> {
  return !!entry && Date.now() - entry.fetchedAt < CACHE_TTL;
}

// ── API functions ───────────────────────────────────────────────────

/**
 * Fetch all online-bookable tennis courts from ActiveNet.
 * Returns ~20 courts across 6+ venues. Cached for 1 hour.
 */
export async function fetchBookableCourts(): Promise<ActiveNetCourt[]> {
  if (isFresh(courtListCache.entry)) {
    return courtListCache.entry.data;
  }

  const body = {
    name: "",
    attendee: 0,
    date_times: [],
    event_type_ids: [],
    facility_type_ids: [TENNIS_OUTDOOR_TYPE_ID, TENNIS_INDOOR_TYPE_ID],
    reservation_group_ids: [],
    amenity_ids: [],
    facility_id: 0,
    equipment_id: 0,
    center_id: 0,
    resource_type: 0,
    client_coordinate: "",
    order_by_field: "name",
    order_direction: "asc",
    page_size: 200,
    start_index: 0,
    search_client_id: "",
    date_time_length: null,
    full_day_booking: false,
    center_ids: [],
    specify_start_and_end_times: false,
  };

  const res = await fetch(`${BASE_URL}/reservation/resource?locale=en-US`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`ActiveNet resource API: ${res.status}`);
  const json = await res.json();

  if (json.headers?.response_code !== "0000") {
    throw new Error(`ActiveNet error: ${json.headers?.response_message}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = json.body?.items || [];
  const courts: ActiveNetCourt[] = items.map((item) => ({
    id: item.id,
    name: item.name,
    centerName: item.center_name,
    centerId: item.center_id,
    typeName: item.type_name,
    capacity: item.max_capacity || 0,
    bookableOnline: !item.no_internet_permits,
    reserveBy: item.reserve_by || "minute",
  }));

  courtListCache.entry = { data: courts, fetchedAt: Date.now() };
  return courts;
}

/**
 * Fetch detailed info for a specific court.
 * Includes hours, capacity, restrictions, amenities.
 */
export async function fetchCourtDetail(
  resourceId: number
): Promise<ActiveNetCourtDetail> {
  const cached = detailCache.get(resourceId);
  if (isFresh(cached)) return cached.data;

  const res = await fetch(
    `${BASE_URL}/reservation/resource/detail/${resourceId}?locale=en-US`
  );
  if (!res.ok) throw new Error(`ActiveNet detail API: ${res.status}`);
  const json = await res.json();

  if (json.headers?.response_code !== "0000") {
    throw new Error(`ActiveNet error: ${json.headers?.response_message}`);
  }

  const g = json.body?.resource_detail?.general_information || {};
  const detail: ActiveNetCourtDetail = {
    id: g.facility_id,
    name: g.facility_name || "",
    centerName: g.center_name || "",
    address: [g.address1, g.address2].filter(Boolean).join(", "),
    city: g.city || "",
    state: g.state || "",
    zip: g.zip_code || "",
    phone: g.phone || "",
    description: g.description || "",
    minTime: g.minimum_time || 60,
    maxTime: g.maximum_time || 180,
    maxCapacity: g.max_mum_capacity || 0,
    openingHours: (json.body?.resource_detail?.opening_hours || []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (h: any) => ({
        dateRange: h.date_range || "",
        daysOfWeek: h.days_of_week || "",
        openingTimes: h.opening_times || "",
      })
    ),
    amenities: (json.body?.resource_detail?.amenities || []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (a: any) => ({ name: a.amenity_name || "" })
    ),
    restrictions: json.body?.resource_detail?.advanced_restrictions || [],
  };

  detailCache.set(resourceId, { data: detail, fetchedAt: Date.now() });
  return detail;
}

/**
 * Group courts by venue (center).
 */
export function groupByVenue(
  courts: ActiveNetCourt[]
): Map<string, ActiveNetCourt[]> {
  const map = new Map<string, ActiveNetCourt[]>();
  for (const c of courts) {
    const existing = map.get(c.centerName) || [];
    existing.push(c);
    map.set(c.centerName, existing);
  }
  return map;
}

/**
 * Build a booking URL for a specific court on ActiveNet.
 */
export function buildBookingUrl(courtName: string): string {
  return `https://anc.apm.activecommunities.com/seattle/reservation/search?keyword=${encodeURIComponent(courtName)}&resourceType=0&equipmentQty=0`;
}

// ── Future: API-key-based availability checking ─────────────────────
//
// When you have ACTIVENET_API_KEY and ACTIVENET_SHARED_SECRET:
//
// import crypto from 'crypto';
//
// function generateSignature(apiKey: string, sharedSecret: string): string {
//   const timestamp = Math.floor(Date.now() / 1000).toString();
//   const hash = crypto.createHash('sha256')
//     .update(apiKey + sharedSecret + timestamp)
//     .digest('hex');
//   return hash;
// }
//
// export async function fetchTimeslots(resourceId: number, date: string) {
//   const apiKey = process.env.ACTIVENET_API_KEY!;
//   const secret = process.env.ACTIVENET_SHARED_SECRET!;
//   const orgId = process.env.ACTIVENET_ORG_ID!;
//   const sig = generateSignature(apiKey, secret);
//
//   const res = await fetch(
//     `https://api.amp.active.com/anet-systemapi-sec/${orgId}/api/v1/facilityschedules` +
//     `?facility_ids=${resourceId}&date_from=${date}&date_to=${date}` +
//     `&api_key=${apiKey}&sig=${sig}`
//   );
//   return res.json();
// }
