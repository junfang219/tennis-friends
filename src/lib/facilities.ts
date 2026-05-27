/**
 * Facility loader for the Seattle-area tennis venue dataset.
 *
 * Single source of truth: `data/tennis_courts.json`. Latitude/longitude live
 * inline with the rest of each venue record. New venues whose coords are still
 * null can be batch-filled by running `npm run geocode:facilities`, which
 * writes results back into this same file. Manual hand-fixes go in the same
 * place. See `data/SCHEMA.md` for field shapes.
 *
 * Universal: imported from both server routes and client pages (the /courts
 * map filters the catalog client-side). The dataset is JSON-imported, so it
 * gets bundled into both the server and client builds at compile time.
 * Editing the JSON requires a dev-server restart to pick up — previously this
 * module re-read from disk on mtime change, but losing that to gain
 * client-side use is worth it (typical workflow only touches the JSON during
 * geocoding scripts, not iterative dev).
 */
import rawDataset from "../../data/tennis_courts.json";
import type { BBox } from "./courts-data/types";

// ── Raw JSON shape (mirrors data/SCHEMA.md exactly) ──────────────────
type IndoorOutdoor = "outdoor" | "indoor" | "both";
type Category =
  | "public_park"
  | "school"
  | "private_club"
  | "hoa_community"
  | "college"
  | "indoor_facility";
type Status = "active" | "temporarily_closed";

interface RawVenue {
  id: number;
  name: string;
  address: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  court_count: number | null;
  lighted: boolean | null;
  hitting_wall: boolean | null;
  pickleball_lined: boolean | null;
  indoor_outdoor: IndoorOutdoor;
  managed_by: string | null;
  reservation_policy: string | null;
  contact_phone: string | null;
  booking_url: string | null;
  court_level_booking_url: string | null;
  // Optional per-venue override for the "Book this court" CTA label.
  // E.g. Pro Tennis Seattle's URL goes to lessons, not court booking.
  booking_label?: string | null;
  // When false, the summary card hides its compact "Book" button — the
  // booking_url is info-only (e.g. club page) rather than an actual
  // booking flow. Defaults to true (unspecified).
  bookable?: boolean;
  // Optional per-venue list of custom booking buttons. When set, the detail
  // page renders these in place of the single "Book this court" button
  // (e.g. Aubrey Davis Park where each court has its own PerfectMind URL).
  booking_links?: Array<{ label: string; url: string }>;
  // Per-venue opt-out for the Seattle Parks Power BI availability dashboard.
  // The dashboard normally surfaces on any Seattle-Parks-managed venue with
  // a booking_url, but a few of those (e.g. high-school complexes whose
  // courts aren't on the dashboard's reservable list) shouldn't show it.
  // Defaults to true when undefined.
  show_availability_dashboard?: boolean;
  // Optional external schedule / events link. Renders as a styled secondary
  // button on the detail page (separate "Events" section). Used when a
  // venue's scheduling info lives at a per-facility URL (e.g. UW IMA).
  events_link?: { label: string; url: string } | null;
  hours: string | null;
  description: string | null;
  notes: string | null;
  category: Category;
  status: Status;
}

interface RawDataset {
  metadata: {
    external_resources?: {
      seattle_parks_availability_dashboard?: { url: string; description?: string };
    };
  };
  venues: RawVenue[];
}

// ── Public facade ────────────────────────────────────────────────────
export type ManagedByBucket = "city" | "club" | "school";

export interface Facility {
  externalId: number;
  /** App-level ID. Prefixed `tf-` to avoid collisions with legacy `sea-N`. */
  courtId: string;
  name: string;
  address: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  courtCount: number | null;
  lighted: boolean | null;
  hittingWall: boolean | null;
  pickleballLined: boolean | null;
  indoorOutdoor: IndoorOutdoor;
  managedBy: string | null;
  reservationPolicy: string | null;
  contactPhone: string | null;
  bookingUrl: string | null;
  courtLevelBookingUrl: string | null;
  /** Override for the primary CTA label on the detail page. Null/undefined
   *  → "Book this court". E.g. Pro Tennis Seattle uses "Book a lesson". */
  bookingLabel: string | null;
  /** When false, the summary card hides its compact "Book" button. Detail
   *  page still renders the (possibly relabeled) primary CTA. Default true. */
  bookable: boolean;
  /** Per-venue list of custom booking buttons. When non-empty, replaces the
   *  single primary CTA on the detail page. Null otherwise. */
  bookingLinks: Array<{ label: string; url: string }> | null;
  /** Opt-out for the Seattle Parks availability dashboard secondary button.
   *  Default true; set false to suppress on venues that shouldn't show it
   *  (e.g. high-school complexes not covered by the dashboard). */
  showAvailabilityDashboard: boolean;
  /** External schedule / events link (e.g. UW IMA's facility schedule).
   *  Renders as a secondary button on the detail page. Null when unset. */
  eventsLink: { label: string; url: string } | null;
  hours: string | null;
  description: string | null;
  notes: string | null;
  category: Category;
  status: Status;
  bucket: ManagedByBucket;
}

// SOURCE retained for messages/log strings.
const SOURCE = "data/tennis_courts.json";

function bucketFor(category: Category, managedBy: string | null): ManagedByBucket {
  if (category === "school" || category === "college" || managedBy === "School") {
    return "school";
  }
  if (category === "private_club" || category === "hoa_community") {
    return "club";
  }
  // public_park, indoor_facility, or null managed_by → city (per user spec)
  return "city";
}

function shapeFacility(v: RawVenue): Facility {
  return {
    externalId: v.id,
    courtId: `tf-${v.id}`,
    name: v.name,
    address: v.address,
    street: v.street,
    city: v.city,
    state: v.state,
    zip: v.zip,
    latitude: v.latitude,
    longitude: v.longitude,
    courtCount: v.court_count,
    lighted: v.lighted,
    hittingWall: v.hitting_wall,
    pickleballLined: v.pickleball_lined,
    indoorOutdoor: v.indoor_outdoor,
    managedBy: v.managed_by,
    reservationPolicy: v.reservation_policy,
    contactPhone: v.contact_phone,
    bookingUrl: v.booking_url,
    courtLevelBookingUrl: v.court_level_booking_url,
    bookingLabel: v.booking_label ?? null,
    bookable: v.bookable !== false, // default true; explicit false suppresses card Book
    bookingLinks:
      Array.isArray(v.booking_links) && v.booking_links.length > 0
        ? v.booking_links
        : null,
    showAvailabilityDashboard: v.show_availability_dashboard !== false,
    eventsLink:
      v.events_link && typeof v.events_link.url === "string" && v.events_link.url.length > 0
        ? { label: v.events_link.label, url: v.events_link.url }
        : null,
    hours: v.hours,
    description: v.description,
    notes: v.notes,
    category: v.category,
    status: v.status,
    bucket: bucketFor(v.category, v.managed_by),
  };
}

let cached: { facilities: Facility[]; dataset: RawDataset } | null = null;
void SOURCE; // kept for logs in describeJsonError below if ever needed.

/** Translate Node's "Unexpected token ... at position N" into a line/col. */
function describeJsonError(raw: string, err: unknown): string {
  if (!(err instanceof Error)) return "";
  void describeJsonError;
  const m = err.message.match(/position\s+(\d+)/);
  if (!m) return "";
  const pos = Number(m[1]);
  if (!Number.isFinite(pos)) return "";
  const before = raw.slice(0, pos);
  const line = before.split("\n").length;
  const col = pos - (before.lastIndexOf("\n") + 1) + 1;
  return ` at line ${line}, column ${col}`;
}

function load(): { facilities: Facility[]; dataset: RawDataset } {
  // JSON is bundled at compile time via the static import above; one parse
  // per process is all we need.
  if (cached) return cached;
  const dataset = rawDataset as unknown as RawDataset;
  const facilities = dataset.venues.map(shapeFacility);
  cached = { facilities, dataset };
  return cached;
}

export function getFacilities(): Facility[] {
  return load().facilities;
}

export function getFacilityByCourtId(courtId: string): Facility | null {
  if (!courtId.startsWith("tf-")) return null;
  const externalId = parseInt(courtId.slice(3), 10);
  if (!Number.isFinite(externalId)) return null;
  return load().facilities.find((f) => f.externalId === externalId) ?? null;
}

/** Best-effort fuzzy match: free-text "court location" string → Facility.
 *  Returns the highest-scoring facility whose name contains the query (or vice
 *  versa). Returns null if nothing matches with confidence. Mirrors the
 *  scoring used by /api/courts/search so the arrival-detection picks the
 *  same facility the user would see in the picker. */
export function resolveFacilityByName(query: string): Facility | null {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return null;
  const facilities = load().facilities;
  let best: { f: Facility; s: number } | null = null;
  for (const f of facilities) {
    if (f.latitude == null || f.longitude == null) continue;
    const n = f.name.toLowerCase();
    let s = 0;
    if (n === q) s = 5;
    else if (n.startsWith(q) || q.startsWith(n)) s = 4;
    else if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(n)) s = 3;
    else if (n.includes(q)) s = 2;
    else if (q.includes(n) && n.length >= 6) s = 1;
    if (s > 0 && (!best || s > best.s || (s === best.s && f.externalId < best.f.externalId))) {
      best = { f, s };
    }
  }
  return best?.f ?? null;
}

/** Top-K fuzzy name match for the courts-page search bar. Mirrors
 *  the scoring used by resolveFacilityByName so the picker and the
 *  search rank identically. Returns at most `limit` facilities sorted
 *  by score desc. */
export function searchFacilitiesByName(query: string, limit: number = 8): Facility[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const facilities = load().facilities;
  const scored: Array<{ f: Facility; s: number }> = [];
  for (const f of facilities) {
    if (f.latitude == null || f.longitude == null) continue;
    const n = f.name.toLowerCase();
    let s = 0;
    if (n === q) s = 5;
    else if (n.startsWith(q) || q.startsWith(n)) s = 4;
    else if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(n)) s = 3;
    else if (n.includes(q)) s = 2;
    else if (q.includes(n) && n.length >= 6) s = 1;
    if (s > 0) scored.push({ f, s });
  }
  scored.sort((a, b) => {
    if (b.s !== a.s) return b.s - a.s;
    return a.f.externalId - b.f.externalId;
  });
  return scored.slice(0, limit).map((x) => x.f);
}

export function filterFacilitiesByBbox(bbox: BBox): Facility[] {
  return load().facilities.filter(
    (f) =>
      f.latitude != null &&
      f.longitude != null &&
      f.latitude >= bbox.south &&
      f.latitude <= bbox.north &&
      f.longitude >= bbox.west &&
      f.longitude <= bbox.east
  );
}

/** Power BI dashboard for Seattle Parks reservable courts (per SCHEMA §external_resources). */
export function getSeattleParksDashboardUrl(): string | null {
  return load().dataset.metadata.external_resources?.seattle_parks_availability_dashboard?.url ?? null;
}

/** First sentence of description, capped at 140 chars. Returns null when no description. */
export function descriptionPreview(description: string | null): string | null {
  if (!description) return null;
  // Stop at the first ". " (sentence terminator). Fallback to first 140 chars.
  const sentenceEnd = description.search(/\.\s/);
  const raw = sentenceEnd > 0 ? description.slice(0, sentenceEnd + 1) : description;
  if (raw.length <= 140) return raw;
  return raw.slice(0, 137).trimEnd() + "…";
}
