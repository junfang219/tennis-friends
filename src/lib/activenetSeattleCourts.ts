/**
 * Static seed of Seattle Parks ActiveNet tennis courts (center + resource IDs).
 *
 * ActiveNet has no "list every court" endpoint that maps cleanly to venues —
 * the IDs have to be harvested by hand. This seed saves that work: the IDs
 * were cross-referenced from the open matchatennis/courts index and verified
 * against the live Seattle Parks ActiveNet system. They are facts about the
 * public reservation system, not a copy of anyone's product.
 *
 * Feed a court's `resourceId` to fetchTimeslots()/fetchCourtDetail() in
 * ./activenet to get live availability. See data/activenet-seattle.json.
 */
import raw from "../../data/activenet-seattle.json";

export interface SeattleCourt {
  name: string;
  centerId: number;
  resourceId: number;
  tags: string[];
}

export interface SeattleVenue {
  name: string;
  centerId: number;
  coordinate: { lat: number; lng: number } | null;
  timezone: string | null;
  courts: SeattleCourt[];
}

const VENUES: SeattleVenue[] = (raw.venues as SeattleVenue[]) ?? [];

/** All seeded Seattle ActiveNet venues, sorted by name. */
export function getSeattleVenues(): SeattleVenue[] {
  return VENUES;
}

/** Every court across every venue (flat list). */
export function getSeattleCourts(): SeattleCourt[] {
  return VENUES.flatMap((v) => v.courts);
}

/** Look up a single court by its ActiveNet resource ID. */
export function getCourtByResourceId(resourceId: number): SeattleCourt | null {
  return getSeattleCourts().find((c) => c.resourceId === resourceId) ?? null;
}

/** Look up a venue by its ActiveNet center ID. */
export function getSeattleVenueByCenterId(centerId: number): SeattleVenue | null {
  return VENUES.find((v) => v.centerId === centerId) ?? null;
}

/** Venues whose name contains `query` (case-insensitive). */
export function findVenuesByName(query: string): SeattleVenue[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return VENUES.filter((v) => v.name.toLowerCase().includes(q));
}

/**
 * Pull the ActiveNet center ID out of a Seattle Parks booking URL. The
 * catalog's reservable Seattle-Parks venues link to the ActiveNet search
 * page with `?...&facilityCenterIds=<id>`, which is the authoritative join
 * key between a catalog Facility and this seed. Returns null when the URL
 * carries no center ID (a handful of venues use resource-level URLs).
 */
export function parseCenterIdFromBookingUrl(
  bookingUrl: string | null | undefined
): number | null {
  if (!bookingUrl) return null;
  const m = bookingUrl.match(/facilityCenterIds=(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Drop the generic "Tennis Court(s)" suffix + parentheticals and normalize
 *  punctuation/whitespace so two names referring to the same place compare
 *  equal (e.g. "Volunteer Park Tennis Court" ≡ seed "Volunteer Park"). */
function normalizeVenueName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // strip "(AYTC)" etc.
    .replace(/\btennis courts?\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Resolve a catalog venue to its seeded ActiveNet venue. Prefers the explicit
 * `facilityCenterIds` in the booking URL; falls back to a CONSERVATIVE name
 * match (equal after stripping the "Tennis Courts" suffix) only when the URL
 * carries no center ID. The strict fallback recovers venues like Volunteer
 * Park (whose URL omits the id) without risking a wrong match for ambiguous
 * pairs like "Green Lake Park East" vs the seed's single "Green Lake Park".
 */
export function resolveSeattleVenue(opts: {
  bookingUrl?: string | null;
  name?: string | null;
}): SeattleVenue | null {
  const centerId = parseCenterIdFromBookingUrl(opts.bookingUrl);
  if (centerId != null) {
    const byId = getSeattleVenueByCenterId(centerId);
    if (byId) return byId;
  }
  if (opts.name) {
    const key = normalizeVenueName(opts.name);
    if (key) {
      const match = VENUES.find((v) => normalizeVenueName(v.name) === key);
      if (match) return match;
    }
  }
  return null;
}
