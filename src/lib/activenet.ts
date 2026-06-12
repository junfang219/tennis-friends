/**
 * ActiveNet REST API client for Seattle Parks tennis courts.
 *
 * Uses the unauthenticated internal REST API that the Seattle Parks
 * reservation SPA calls for itself:
 *   POST /seattle/rest/reservation/resource — lists bookable courts
 *   GET  /seattle/rest/reservation/resource/detail/{id} — court details
 *   GET  /seattle/rest/reservation/resource/availability/daily/{id} — open slots
 *
 * No API key, shared secret, or signature is required — these are the same
 * public endpoints the live site hits. (An earlier version of this file
 * assumed availability needed the signed ActiveNet "System API" at
 * api.amp.active.com; it does not. The SPA backend below is the real source.)
 *
 * IMPORTANT: the detail + availability endpoints return an EMPTY body unless
 * the `page_info` header is present. Every GET here sends it.
 */

const BASE_URL = "https://anc.apm.activecommunities.com/seattle/rest";
const TENNIS_OUTDOOR_TYPE_ID = 39;
const TENNIS_INDOOR_TYPE_ID = 115;

// The detail/availability endpoints 204 out without this header.
const PAGE_INFO_HEADER = {
  page_info: JSON.stringify({ page_number: 1, total_records_per_page: 20 }),
  "X-Requested-With": "XMLHttpRequest",
};

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

/** A single bookable (open) window on a court for a given day. */
export interface Timeslot {
  date: string; // "YYYY-MM-DD"
  startTime: string; // "HH:mm:ss"
  endTime: string; // "HH:mm:ss"
  available: boolean;
}

export interface DayAvailability {
  date: string; // "YYYY-MM-DD"
  /**
   * ActiveNet's per-day status code. Observed values:
   *   0 — bookable day (slots present when not fully booked)
   *   7 — today / same-day: online booking closed, so `times` is empty even
   *       though courts may be free to walk on (the official site shows this
   *       day view-only)
   *   8 — beyond the ~15-day reservation window
   * Anything non-zero means "no online booking for this day", which is how the
   * UI tells "view-only / closed" apart from "fully booked" (status 0, no slots).
   */
  status: number | null;
  slots: Timeslot[];
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

// Availability changes minute-to-minute as people book, so it gets a much
// shorter TTL than the (effectively static) court list and detail data.
const availabilityCache = new Map<string, CacheEntry<DayAvailability[]>>();
const AVAILABILITY_TTL = 2 * 60 * 1000; // 2 minutes

function isFresh<T>(entry: CacheEntry<T> | null | undefined): entry is CacheEntry<T> {
  return !!entry && Date.now() - entry.fetchedAt < CACHE_TTL;
}

// ── API functions ───────────────────────────────────────────────────

/**
 * Fetch all online-bookable tennis courts from ActiveNet.
 * Returns courts across all venues. Cached for 1 hour.
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
    headers: { "Content-Type": "application/json", ...PAGE_INFO_HEADER },
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
    `${BASE_URL}/reservation/resource/detail/${resourceId}?locale=en-US`,
    { headers: PAGE_INFO_HEADER }
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
 * Parse the `availability/daily` response body into day-grouped open slots.
 * Pure (no network) so it can be unit-tested against captured payloads.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseDailyAvailability(json: any): DayAvailability[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const days: any[] = json?.body?.details?.daily_details || [];
  return days.map((day) => ({
    date: day.date,
    status: typeof day.status === "number" ? day.status : null,
    slots: (day.times || [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((t: any) => ({
        date: day.date,
        startTime: t.start_time,
        endTime: t.end_time,
        available: t.available !== false,
      }))
      .filter((s: Timeslot) => s.startTime && s.endTime),
  }));
}

/**
 * Fetch open booking windows for a court over a date range (inclusive).
 * Returns one entry per day, each holding that day's open slots. Cached
 * for 2 minutes since availability shifts as people book.
 *
 * @param resourceId ActiveNet resource ID (e.g. 279 = Amy Yee Court 01)
 * @param startDate  "YYYY-MM-DD"
 * @param endDate    "YYYY-MM-DD" (defaults to startDate, i.e. a single day)
 */
export async function fetchTimeslots(
  resourceId: number,
  startDate: string,
  endDate: string = startDate
): Promise<DayAvailability[]> {
  const key = `${resourceId}:${startDate}:${endDate}`;
  const cached = availabilityCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < AVAILABILITY_TTL) {
    return cached.data;
  }

  const url =
    `${BASE_URL}/reservation/resource/availability/daily/${resourceId}` +
    `?start_date=${startDate}&end_date=${endDate}&locale=en-US`;
  const res = await fetch(url, { headers: PAGE_INFO_HEADER });
  if (!res.ok) throw new Error(`ActiveNet availability API: ${res.status}`);
  const json = await res.json();

  if (json.headers?.response_code !== "0000") {
    throw new Error(`ActiveNet error: ${json.headers?.response_message}`);
  }

  const days = parseDailyAvailability(json);
  availabilityCache.set(key, { data: days, fetchedAt: Date.now() });
  return days;
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
