"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import "leaflet/dist/leaflet.css";
import {
  CourtSummaryCard,
  type CourtSummary,
} from "@/components/courts/CourtSummaryCard";
import { AddMissingCourtModal } from "@/components/courts/AddMissingCourtModal";
import {
  filterFacilitiesByBbox,
  getFacilityByCourtId,
  searchFacilitiesByName,
  descriptionPreview,
  type Facility,
} from "@/lib/facilities";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getCurrentPosition, isPositionError } from "@/lib/getCurrentPosition";
import { errorMessage } from "@/lib/errorMessage";

type ManagedByBucket = "city" | "club" | "school";

type CourtData = {
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
  /** Facility-only fields (undefined for curated/OSM markers). */
  bucket?: ManagedByBucket;
  bookingUrl?: string | null;
  category?: string;
  status?: "active" | "temporarily_closed";
  descriptionPreview?: string | null;
};

// Dev-only flag: Next.js inlines process.env.NODE_ENV at build time, so
// production bundles strip the editor UI and PATCH call sites entirely.
const IS_DEV = process.env.NODE_ENV !== "production";

// Tab-scoped cache of the last successful bbox fetch. Lets us paint markers
// instantly when the user returns from /courts/[id], instead of waiting on a
// fresh /api/courts round-trip (~1s). Background refresh still runs.
// Bump the version when the dataset shape changes or stale entries need to
// be evicted across all open tabs (e.g. a venue was removed and clients
// still hold the old id in cache).
const CACHE_KEY = "tennisfriend:courts-cache:v2";

function readCachedCourts(): CourtData[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.courts) ? (parsed.courts as CourtData[]) : null;
  } catch {
    return null;
  }
}

function writeCachedCourts(courts: CourtData[]): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ courts, fetchedAt: Date.now(), v: 1 })
    );
  } catch {
    // Safari private mode etc. — silent fail; we just won't have the cache.
  }
}

// Tennis-ball marker variants per managed_by bucket. Colors are from the
// Wong palette (Nature Methods, 2011) — chosen to remain distinguishable
// under deuteranopia, protanopia, and tritanopia. Non-facility markers
// (curated lists outside Seattle, OSM fallbacks) fall back to city.
const BUCKET_MARKER_BG: Record<ManagedByBucket, string> = {
  city: "#009E73",   // bluish green
  club: "#D55E00",   // vermillion
  school: "#56B4E9", // sky blue
};
const BUCKET_MARKER_BORDER: Record<ManagedByBucket, string> = {
  city: "#00513C",
  club: "#6E3000",
  school: "#0E4A7F",
};

type GeocodeResult = {
  displayName: string;
  lat: number;
  lon: number;
  /** [south, north, west, east] — Nominatim's order is [south, north, west, east] as strings */
  boundingBox?: [number, number, number, number];
};

// Tennis-court match from the static facility-catalog search (see
// searchFacilitiesByName + the courtsPromise block below). Shape
// mirrors the subset of Facility fields the map row needs so we can
// pre-populate courtsMapRef with consistent data when the user picks
// one.
type CourtSearchResult = {
  courtId: string;
  name: string;
  address: string | null;
  city: string | null;
  lat: number;
  lng: number;
  bucket: ManagedByBucket;
  category: string;
  bookable: boolean;
  bookingUrl: string | null;
  courts: number | null;
  descriptionPreview: string | null;
};

const DEFAULT_CENTER: [number, number] = [47.6062, -122.3321]; // Seattle
const DEFAULT_ZOOM = 12;
const MIN_FETCH_ZOOM = 11;
// Catch-all proxy route that forwards everything under /seattle/* to ActiveNet.
// Using /seattle/reservation/search matches ActiveNet's own URL path so that
// relative URLs in the SPA (like /seattle/css/..., /seattle/rest/...) resolve
// back to our proxy — keeping the entire iframe same-origin.
const SEATTLE_PROXY_URL =
  "/seattle/reservation/search?keyword=tennis%20court&resourceType=0&equipmentQty=0";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Leaflet = any;

function getLeaflet(): Leaflet | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as unknown as { L?: any }).L || null;
}

// Bundled via npm — eliminates the unpkg round-trip (which sometimes hangs
// silently inside the Capacitor WebView and leaves the map stuck on a grey
// "Loading map…" overlay forever). Leaflet's UMD always assigns itself to
// window.L when it runs, so we rely on that rather than guessing the
// import's shape (no default export on the CJS build).
let leafletPromise: Promise<Leaflet> | null = null;
function ensureLeaflet(): Promise<Leaflet> {
  const existing = getLeaflet();
  if (existing) return Promise.resolve(existing);
  if (!leafletPromise) {
    leafletPromise = import("leaflet")
      .then(() => getLeaflet())
      .catch((err) => {
        console.error("Failed to load Leaflet:", err);
        leafletPromise = null;
        throw err;
      });
  }
  return leafletPromise;
}

export default function CourtsPage() {
  // `?selected=tf-N` lets the detail page send us back to a specific court —
  // we'll pan the map to it and auto-pop its summary card instead of
  // recentering on the user's geolocation. `?z=&lat=&lng=` optionally
  // restores the exact map view (zoom + center) the user had when they
  // tapped Details — so a city-level view returns to city-level, not
  // jumped to street-level.
  const searchParams = useSearchParams();
  const selectedParam = searchParams.get("selected");
  const restoreZoom = parseInt(searchParams.get("z") ?? "", 10);
  const restoreLat = parseFloat(searchParams.get("lat") ?? "");
  const restoreLng = parseFloat(searchParams.get("lng") ?? "");
  const hasRestoreView =
    Number.isFinite(restoreZoom) &&
    Number.isFinite(restoreLat) &&
    Number.isFinite(restoreLng);

  const [isNative, setIsNative] = useState(false);
  useEffect(() => {
    // `window.Capacitor` exists in the web bundle too (assigned by the
    // @capacitor/core stub when imported). Use `isNativePlatform()` to tell
    // the iOS/Android shell apart from the browser.
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    setIsNative(!!cap?.isNativePlatform?.());
  }, []);
  const [courts, setCourts] = useState<CourtData[]>([]);
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [fetching, setFetching] = useState(false);
  const [zoomTooLow, setZoomTooLow] = useState(false);

  // Seattle Parks side panel (closed by default — user opens via button)
  const [sidePanelOpen, setSidePanelOpen] = useState(false);

  // Map search (Nominatim geocoder) — lets users type "Costa Mesa" or
  // "Brooklyn" and pan the map there instead of dragging to find it.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
  // Court-name matches from the static facility catalog, shown above
  // places in the dropdown. Empty array = no court matches for the
  // current query.
  const [courtResults, setCourtResults] = useState<CourtSearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  // Iframe ref — used to detect and recover from cross-origin navigation
  // (e.g. after login, when ActiveNet redirects to an absolute activecommunities.com URL)
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // When the iframe loads, check if it's still same-origin with our proxy.
  // If ActiveNet's post-login flow navigated it to an absolute
  // anc.apm.activecommunities.com URL, the cross-origin access will throw —
  // we catch that and reload the iframe with the default proxy URL. The
  // login session cookies are already stored on our domain, so the reloaded
  // page will show the user as authenticated.
  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const cw = iframe.contentWindow;
      const path = cw?.location?.pathname;
      if (!path || !path.startsWith("/seattle/")) {
        // Not our proxy — force reload through the proxy URL
        iframe.src = SEATTLE_PROXY_URL;
      }
    } catch {
      // Cross-origin access threw — reset to proxy URL
      iframe.src = SEATTLE_PROXY_URL;
    }
  }, []);

  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userMarkerRef = useRef<any>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summaryDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchTokenRef = useRef(0);
  const courtsMapRef = useRef<Map<string, CourtData>>(new Map());

  // Aggregate review summaries (avg / count / thumbs) keyed by court id.
  // Populated via court_reviews after each viewport fetch.
  const [summaries, setSummaries] = useState<Record<string, CourtSummary>>({});

  // Which court (if any) the user tapped — drives the slide-up card.
  const [selectedCourtId, setSelectedCourtId] = useState<string | null>(null);
  // Drives the "Report a missing court" modal launched from the legend.
  const [addCourtOpen, setAddCourtOpen] = useState(false);
  // Active legend filter. null = show all buckets; otherwise only pins whose
  // bucket matches are drawn (OSM gap-fill pins are hidden too, since they
  // have no bucket).
  const [bucketFilter, setBucketFilter] = useState<ManagedByBucket | null>(null);

  // Current map center + zoom. The card uses this to encode the user's
  // exact view into the Details link so we can restore it on return.
  const [mapView, setMapView] = useState<{
    lat: number;
    lng: number;
    zoom: number;
  } | null>(null);

  // ── Dev-only drag-to-edit pin coordinates ─────────────────────────
  // Gated by NODE_ENV — Next.js inlines this at build, so the editor UI
  // and PATCH calls are stripped from production bundles.
  const [editingCourtId, setEditingCourtId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ lat: number; lng: number } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  // id → leaflet marker, for O(1) lookup when toggling drag state.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersByIdRef = useRef<Map<string, any>>(new Map());
  // Original coords captured at edit-start, so Cancel can snap back.
  const editOriginalRef = useRef<{ lat: number; lng: number } | null>(null);

  const runFetch = useCallback(async () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (map.getZoom() < MIN_FETCH_ZOOM) {
      setZoomTooLow(true);
      return;
    }
    setZoomTooLow(false);
    const b = map.getBounds();
    const south = b.getSouth();
    const west = b.getWest();
    const north = b.getNorth();
    const east = b.getEast();
    const params = new URLSearchParams({
      south: south.toFixed(6),
      west: west.toFixed(6),
      north: north.toFixed(6),
      east: east.toFixed(6),
    });
    const token = ++fetchTokenRef.current;
    setFetching(true);
    setLoadError("");
    try {
      // The legacy /api/courts route did a server-side bbox filter against
      // the static catalog. With the catalog living client-side
      // (src/lib/courts-data via facilities.ts) we can do the same filter
      // here without a roundtrip. Params is now unused but the var is kept
      // for compatibility with the older logging that referenced it.
      void params;
      const data: CourtData[] = filterFacilitiesByBbox({
        south, west, north, east,
      }).map((f) => {
        const indoor = f.indoorOutdoor === "indoor" || f.indoorOutdoor === "both";
        const bucket: ManagedByBucket | undefined =
          f.category === "private_club" || f.category === "hoa_community"
            ? "club"
            : f.category === "school" || f.category === "college"
              ? "school"
              : "city";
        return {
          id: f.courtId,
          type: "tennis",
          osmId: 0,
          lat: f.latitude ?? 0,
          lng: f.longitude ?? 0,
          name: f.name,
          surface: indoor ? "indoor" : "hard",
          access: f.bookable ? "public" : undefined,
          lit: f.lighted ?? undefined,
          courts: f.courtCount ?? undefined,
          address: f.address,
          source: "facility" as const,
          bucket,
          bookingUrl: f.bookingUrl,
          category: f.category ?? undefined,
        };
      });
      if (token !== fetchTokenRef.current) return;
      // Prune cached entries that lie inside the fetched bbox but weren't
      // returned by the server — that means they were removed from the
      // dataset (or no longer match filters). Without this, deleted venues
      // linger forever in courtsMapRef + sessionStorage.
      const returnedIds = new Set(data.map((c) => c.id));
      for (const [id, c] of courtsMapRef.current) {
        if (
          c.lat >= south &&
          c.lat <= north &&
          c.lng >= west &&
          c.lng <= east &&
          !returnedIds.has(id)
        ) {
          courtsMapRef.current.delete(id);
        }
      }
      for (const c of data) courtsMapRef.current.set(c.id, c);
      const next = Array.from(courtsMapRef.current.values());
      setCourts(next);
      writeCachedCourts(next);
    } catch {
      if (token !== fetchTokenRef.current) return;
      setLoadError("Couldn't load courts. Try again.");
    } finally {
      if (token === fetchTokenRef.current) setFetching(false);
    }
  }, []);

  const scheduleFetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runFetch(), 600);
  }, [runFetch]);

  // ── Map search (Nominatim geocoder) ──────────────────────────────
  // Debounced so we only hit Nominatim ~400ms after the user stops typing,
  // respecting their acceptable-use policy (max 1 req/sec, no type-ahead).
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setCourtResults([]);
      setSearchOpen(false);
      setSearchLoading(false);
      return;
    }
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (searchAbortRef.current) searchAbortRef.current.abort();
    setSearchLoading(true);
    searchDebounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      searchAbortRef.current = controller;
      // Run our court-name search and Nominatim in parallel. Each is
      // independent — a Nominatim outage doesn't block court matches and
      // vice versa.
      const courtsPromise = (async (): Promise<CourtSearchResult[]> => {
        // The legacy /api/courts/search route was deleted in the
        // Prisma→Supabase burn-down; the search now runs against the
        // static facility catalog (src/lib/facilities) bundled with
        // the client. Same scoring as resolveFacilityByName so the
        // picker and search rank identically.
        const facilities: Facility[] = searchFacilitiesByName(q, 8);
        return facilities.map((f) => ({
          courtId: f.courtId,
          name: f.name,
          address: f.address,
          city: f.city,
          lat: f.latitude as number,
          lng: f.longitude as number,
          bucket:
            f.category === "school" || f.category === "college" || f.managedBy === "School"
              ? "school"
              : f.category === "private_club" || f.category === "hoa_community"
              ? "club"
              : "city",
          category: f.category,
          bookable: f.bookable,
          bookingUrl: f.bookingUrl,
          courts: f.courtCount,
          descriptionPreview: descriptionPreview(f.description),
        }));
      })();
      const placesPromise = (async (): Promise<GeocodeResult[]> => {
        try {
          const url =
            "https://nominatim.openstreetmap.org/search?" +
            "q=" +
            encodeURIComponent(q) +
            "&format=json&limit=5&addressdetails=0";
          const res = await fetch(url, { signal: controller.signal });
          if (!res.ok) throw new Error(`Nominatim ${res.status}`);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const data: any[] = await res.json();
          return data
            .map((r) => {
              const bb =
                Array.isArray(r.boundingbox) && r.boundingbox.length === 4
                  ? ([
                      parseFloat(r.boundingbox[0]),
                      parseFloat(r.boundingbox[1]),
                      parseFloat(r.boundingbox[2]),
                      parseFloat(r.boundingbox[3]),
                    ] as [number, number, number, number])
                  : undefined;
              return {
                displayName: r.display_name || "",
                lat: parseFloat(r.lat),
                lon: parseFloat(r.lon),
                boundingBox: bb,
              };
            })
            .filter((r) => !isNaN(r.lat) && !isNaN(r.lon));
        } catch (err) {
          if ((err as Error).name === "AbortError") throw err;
          return [];
        }
      })();
      try {
        const [courts, places] = await Promise.all([courtsPromise, placesPromise]);
        setCourtResults(courts);
        setSearchResults(places);
        setSearchOpen(courts.length > 0 || places.length > 0);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setCourtResults([]);
          setSearchResults([]);
          setSearchOpen(false);
        }
      } finally {
        setSearchLoading(false);
      }
    }, 400);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery]);

  // Click-outside dismiss for the search dropdown
  useEffect(() => {
    if (!searchOpen) return;
    const onDocDown = (e: PointerEvent) => {
      if (
        searchBoxRef.current &&
        !searchBoxRef.current.contains(e.target as Node)
      ) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDocDown);
    return () => document.removeEventListener("pointerdown", onDocDown);
  }, [searchOpen]);

  const selectSearchResult = useCallback((r: GeocodeResult) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    // Prefer fitBounds when Nominatim returns a bbox — better framing for
    // cities. Fall back to setView with zoom 13 for points/POIs.
    if (r.boundingBox) {
      const [south, north, west, east] = r.boundingBox;
      map.fitBounds([
        [south, west],
        [north, east],
      ]);
    } else {
      map.setView([r.lat, r.lon], 13);
    }
    // Keep just the place name in the input; trim trailing ", CA, USA" etc.
    const firstPart = r.displayName.split(",")[0].trim();
    setSearchQuery(firstPart);
    setSearchOpen(false);
  }, []);

  // Picking a court from the dropdown: pre-populate so its marker + summary
  // card render before the next bbox fetch lands, pan to street level, and
  // open the card. Mirrors the URL-restore effect for `?selected=tf-N`.
  const selectCourtResult = useCallback((c: CourtSearchResult) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    courtsMapRef.current.set(c.courtId, {
      id: c.courtId,
      type: "facility",
      osmId: 0,
      lat: c.lat,
      lng: c.lng,
      name: c.name,
      courts: c.courts ?? undefined,
      address: c.address ?? undefined,
      source: "facility",
      bucket: c.bucket,
      bookingUrl: c.bookingUrl,
      category: c.category,
      descriptionPreview: c.descriptionPreview,
    });
    setCourts(Array.from(courtsMapRef.current.values()));
    setSelectedCourtId(c.courtId);
    map.setView([c.lat, c.lng], 16);
    setSearchQuery(c.name);
    setSearchOpen(false);
  }, []);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchResults([]);
    setCourtResults([]);
    setSearchOpen(false);
  }, []);

  // Initialize map
  useEffect(() => {
    let cancelled = false;
    ensureLeaflet().then((L) => {
      if (cancelled || !mapRef.current || mapInstanceRef.current || !L) return;
      const map = L.map(mapRef.current).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);
      mapInstanceRef.current = map;
      const syncView = () => {
        const c = map.getCenter();
        setMapView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
      };
      map.on("moveend", () => {
        scheduleFetch();
        syncView();
      });
      // Leaflet measures the container at construction time. If the parent
      // hadn't been laid out (or the page transitioned in), it ends up
      // computing zero tiles to fetch — which renders as a grey panel. A
      // follow-up invalidateSize() forces it to re-measure and request the
      // correct tile set.
      requestAnimationFrame(() => map.invalidateSize());
      syncView();
      setMapReady(true);
      scheduleFetch();
    });
    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [scheduleFetch]);

  // Invalidate map size when the side panel toggles so Leaflet recomputes layout
  useEffect(() => {
    if (!mapReady) return;
    const map = mapInstanceRef.current;
    if (!map) return;
    const t = setTimeout(() => map.invalidateSize(), 350);
    return () => clearTimeout(t);
  }, [sidePanelOpen, mapReady]);

  // Geolocation via the cross-platform helper (Capacitor on native, browser
  // API on web). Avoids WebKit's "insecure connection" block on physical
  // iPhones loading dev server over LAN IP.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) setGeoError(true);
    }, 12_000);
    (async () => {
      const pos = await getCurrentPosition();
      if (cancelled) return;
      clearTimeout(timer);
      if (isPositionError(pos)) {
        setGeoError(true);
      } else {
        setMyLocation({ lat: pos.latitude, lng: pos.longitude });
        setGeoError(false);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Recenter on user — but skip the pan when the user arrived via
  // `?selected=tf-N` from the detail page (we want them on the court they
  // were viewing, not jerked back to their location). The "you are here"
  // marker still drops at their actual location.
  useEffect(() => {
    if (!mapReady || !myLocation) return;
    const L = getLeaflet();
    const map = mapInstanceRef.current;
    if (!L || !map) return;
    if (!selectedParam) {
      map.setView([myLocation.lat, myLocation.lng], 13);
    }
    if (userMarkerRef.current) userMarkerRef.current.remove();
    const youIcon = L.divIcon({
      className: "",
      html: `<div style="width:18px;height:18px;background:#2D6A4F;border:3px solid white;border-radius:9999px;box-shadow:0 0 0 2px #2D6A4F44,0 2px 6px rgba(0,0,0,0.3)"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    const marker = L.marker([myLocation.lat, myLocation.lng], { icon: youIcon }).addTo(map);
    marker.bindPopup("<b>You are here</b>");
    userMarkerRef.current = marker;
  }, [mapReady, myLocation, selectedParam]);

  // Hydrate `courts` from sessionStorage so markers paint instantly on
  // return-from-detail, instead of waiting ~1s for the bbox refetch. The
  // background fetch (triggered by moveend after the restore-effect pans)
  // still runs and overwrites with fresh data.
  useEffect(() => {
    const cached = readCachedCourts();
    if (!cached || cached.length === 0) return;
    courtsMapRef.current = new Map(cached.map((c) => [c.id, c]));
    setCourts(cached);
    // Empty deps intentional: one-shot on mount; subsequent fetches handle updates.
  }, []);

  // Restore the previously-viewed court when the user came back via
  // /courts?selected=tf-N. Fetch its detail (for coords), pan the map there,
  // pre-populate courtsMapRef so the summary card renders immediately, and
  // open the card. The natural moveend → scheduleFetch then loads the rest
  // of the bbox.
  useEffect(() => {
    if (!mapReady || !selectedParam) return;
    let cancelled = false;
    (async () => {
      try {
        // Resolve from the static catalog now that the legacy /api/courts/[id]
        // route is gone. Same lookup the detail page uses.
        const f = getFacilityByCourtId(selectedParam);
        if (!f || cancelled) return;
        if (typeof f.latitude !== "number" || typeof f.longitude !== "number") return;
        const map = mapInstanceRef.current;
        if (!map) return;
        const bucket: ManagedByBucket =
          f.category === "private_club" || f.category === "hoa_community"
            ? "club"
            : f.category === "school" || f.category === "college"
              ? "school"
              : "city";
        courtsMapRef.current.set(selectedParam, {
          id: selectedParam,
          type: "facility",
          osmId: 0,
          lat: f.latitude,
          lng: f.longitude,
          name: f.name,
          courts: f.courtCount ?? undefined,
          address: f.address,
          source: "facility",
          bucket,
          bookingUrl: f.bookingUrl,
          category: f.category ?? undefined,
          status: undefined,
          descriptionPreview: null,
        } as CourtData);
        setCourts(Array.from(courtsMapRef.current.values()));
        setSelectedCourtId(selectedParam);
        if (hasRestoreView) {
          map.setView([restoreLat, restoreLng], restoreZoom);
        } else {
          map.setView([f.latitude, f.longitude], 16);
        }
      } catch {
        // Silent: bad/expired ?selected= just falls through to normal map.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mapReady, selectedParam, hasRestoreView, restoreLat, restoreLng, restoreZoom]);

  // Render court markers. Skipped while a pin is being edited so the
  // in-progress drag isn't yanked out from under the user.
  useEffect(() => {
    if (!mapReady) return;
    if (editingCourtId !== null) return;
    const L = getLeaflet();
    const map = mapInstanceRef.current;
    if (!L || !map) return;

    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    markersByIdRef.current.clear();

    // Build (and cache) one divIcon per bucket so we're not allocating a new
    // icon per marker on every render.
    const iconCache = new Map<ManagedByBucket, unknown>();
    const iconFor = (bucket: ManagedByBucket) => {
      const cached = iconCache.get(bucket);
      if (cached) return cached;
      const bg = BUCKET_MARKER_BG[bucket];
      const border = BUCKET_MARKER_BORDER[bucket];
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:22px;height:22px;background:${bg};border:3px solid ${border};border-radius:9999px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.25);font-size:11px;cursor:pointer" aria-label="Tennis court (${bucket})">🎾</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      iconCache.set(bucket, icon);
      return icon;
    };

    // Subdued style for OSM gap-fill markers — they sit outside our curated
    // dataset, so we don't have rich detail / booking / category info for
    // them. Smaller gray dot, no emoji, non-interactive: visible (so users
    // see a court exists there) but inert (no broken card / 404 detail).
    const osmIcon = L.divIcon({
      className: "",
      html: `<div style="width:12px;height:12px;background:#9CA3AF;border:2px solid #4B5563;border-radius:9999px;box-shadow:0 1px 3px rgba(0,0,0,0.2);opacity:0.7" aria-label="Tennis court (limited info)"></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });

    for (const c of courts) {
      if (c.source === "osm") {
        // OSM gap-fill pins have no bucket; suppress them when any bucket
        // filter is active so the legend filter behaves consistently.
        if (bucketFilter !== null) continue;
        // Inert marker — drop pin only, no click handler, no id→marker
        // entry (the edit-pin path only applies to facilities anyway).
        const marker = L.marker([c.lat, c.lng], {
          icon: osmIcon,
          interactive: false,
        }).addTo(map);
        markersRef.current.push(marker);
        continue;
      }
      const bucket: ManagedByBucket = c.bucket ?? "city";
      if (bucketFilter !== null && bucket !== bucketFilter) continue;
      const marker = L.marker([c.lat, c.lng], { icon: iconFor(bucket) }).addTo(map);
      // Tap → open the slide-up summary card. Replaces the old Leaflet popup
      // so we can render React (photos, ratings, actions) inside it.
      marker.on("click", () => setSelectedCourtId(c.id));
      markersRef.current.push(marker);
      markersByIdRef.current.set(c.id, marker);
    }
  }, [courts, mapReady, editingCourtId, bucketFilter]);

  // Enable/disable drag on the marker currently being edited.
  useEffect(() => {
    if (!mapReady) return;
    if (editingCourtId === null) return;
    const marker = markersByIdRef.current.get(editingCourtId);
    if (!marker) return;
    marker.dragging?.enable();
    const onDrag = () => {
      const { lat, lng } = marker.getLatLng();
      setEditDraft({ lat, lng });
    };
    marker.on("drag", onDrag);
    marker.on("dragend", onDrag);
    return () => {
      marker.off("drag", onDrag);
      marker.off("dragend", onDrag);
      marker.dragging?.disable();
    };
  }, [editingCourtId, mapReady]);

  // Begin edit on the selected pin.
  const beginEditPin = useCallback(() => {
    if (!IS_DEV) return;
    const c = selectedCourtId !== null ? courtsMapRef.current.get(selectedCourtId) : null;
    if (!c) return;
    editOriginalRef.current = { lat: c.lat, lng: c.lng };
    setEditDraft({ lat: c.lat, lng: c.lng });
    setEditError(null);
    setEditingCourtId(c.id);
  }, [selectedCourtId]);

  const cancelEditPin = useCallback(() => {
    const marker = editingCourtId ? markersByIdRef.current.get(editingCourtId) : null;
    if (marker && editOriginalRef.current) {
      marker.setLatLng([editOriginalRef.current.lat, editOriginalRef.current.lng]);
    }
    setEditingCourtId(null);
    setEditDraft(null);
    setEditError(null);
    setEditSaving(false);
    editOriginalRef.current = null;
  }, [editingCourtId]);

  const saveEditPin = useCallback(async () => {
    if (!editingCourtId || !editDraft) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: upErr } = await supabase
        .from("courts")
        .update({ latitude: editDraft.lat, longitude: editDraft.lng })
        .eq("id", editingCourtId);
      if (upErr) {
        throw new Error(upErr.message || "Save failed");
      }
      // Optimistically update the in-memory courts map so the marker stays
      // put after the rebuild, without waiting for the refetch round-trip.
      const cached = courtsMapRef.current.get(editingCourtId);
      if (cached) {
        courtsMapRef.current.set(editingCourtId, { ...cached, lat: editDraft.lat, lng: editDraft.lng });
        setCourts(Array.from(courtsMapRef.current.values()));
      }
      setEditingCourtId(null);
      setEditDraft(null);
      editOriginalRef.current = null;
      // Refetch so review summaries / dataset state stay consistent.
      runFetch();
    } catch (err) {
      setEditError(errorMessage(err, "Save failed"));
    } finally {
      setEditSaving(false);
    }
  }, [editingCourtId, editDraft, runFetch]);

  // Whenever the visible court set changes, batch-fetch review summaries so
  // the slide-up card has rating + thumbs ready when the user taps a pin.
  useEffect(() => {
    if (courts.length === 0) return;
    if (summaryDebounceRef.current) clearTimeout(summaryDebounceRef.current);
    summaryDebounceRef.current = setTimeout(async () => {
      // court_reviews.court_id is text and accepts both UUID user-added court
      // IDs and "tf-N" static-catalog facility IDs, so we can batch-fetch
      // every visible pin's summary in one call.
      const ids = courts
        .map((c) => c.id)
        .filter((id) => summaries[id] === undefined)
        .slice(0, 200);
      if (ids.length === 0) return;
      try {
        const supabase = createSupabaseBrowserClient();
        const { data } = await supabase
          .from("court_reviews")
          .select(
            `court_id, stars,
             photos:court_review_photos ( url )`
          )
          .in("court_id", ids);
        type Row = {
          court_id: string;
          stars: number;
          photos: { url: string }[];
        };
        const grouped = new Map<string, { sum: number; n: number; thumbs: string[] }>();
        for (const row of (data ?? []) as Row[]) {
          const cur = grouped.get(row.court_id) ?? { sum: 0, n: 0, thumbs: [] };
          cur.sum += row.stars;
          cur.n += 1;
          for (const ph of row.photos) {
            if (cur.thumbs.length < 3) cur.thumbs.push(ph.url);
          }
          grouped.set(row.court_id, cur);
        }
        const next: Record<string, CourtSummary> = {};
        for (const id of ids) {
          const g = grouped.get(id);
          next[id] = g
            ? { avg: g.n === 0 ? 0 : g.sum / g.n, count: g.n, thumbs: g.thumbs }
            : { avg: 0, count: 0, thumbs: [] };
        }
        setSummaries((prev) => ({ ...prev, ...next }));
      } catch {
        // best-effort — pin still works without summary
      }
    }, 350);
    return () => {
      if (summaryDebounceRef.current) clearTimeout(summaryDebounceRef.current);
    };
    // We intentionally watch only `courts` length+identity, not `summaries`,
    // to avoid an effect loop when summaries fill in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courts]);

  const selectedCourt =
    selectedCourtId !== null
      ? courtsMapRef.current.get(selectedCourtId) ?? null
      : null;

  return (
    <div className="relative w-full" style={{ height: isNative ? "calc(100vh - 64px - 5rem)" : "calc(100vh - 64px)" }}>
      {/* Split layout: side panel (left) + map (right) */}
      <div className="flex h-full">
        {/* ── SEATTLE PARKS SIDE PANEL (LEFT) ── */}
        <aside
          className={`flex-shrink-0 h-full bg-white border-r border-court-green-pale/20 flex flex-col transition-all duration-300 ${
            sidePanelOpen ? "w-full sm:w-[460px] md:w-[520px]" : "w-0 overflow-hidden"
          }`}
          aria-label="Seattle Parks booking panel"
        >
          {sidePanelOpen && (
            <>
              {/* Header with iframe navigation (back / home / close) */}
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100 bg-court-green text-white flex-shrink-0">
                {/* Left: iframe back + home */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {/* Back — goes to previous page inside the iframe */}
                  <button
                    onClick={() => {
                      try { iframeRef.current?.contentWindow?.history.back(); } catch {}
                    }}
                    className="w-8 h-8 rounded-full hover:bg-white/20 flex items-center justify-center"
                    aria-label="Go back in Seattle Parks"
                    title="Back"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                  {/* Home — reloads the search results page */}
                  <button
                    onClick={() => {
                      if (iframeRef.current) iframeRef.current.src = SEATTLE_PROXY_URL;
                    }}
                    className="w-8 h-8 rounded-full hover:bg-white/20 flex items-center justify-center"
                    aria-label="Back to search results"
                    title="Search results"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                      <polyline points="9 22 9 12 15 12 15 22" />
                    </svg>
                  </button>
                </div>
                {/* Center: title */}
                <div className="min-w-0 flex-1 mx-2">
                  <h2 className="font-display font-bold text-sm truncate text-center">Book on Seattle Parks</h2>
                </div>
                {/* Right: close panel */}
                <button
                  onClick={() => setSidePanelOpen(false)}
                  className="w-8 h-8 rounded-full hover:bg-white/20 flex items-center justify-center flex-shrink-0"
                  aria-label="Close Seattle Parks panel"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              {/* Iframe body — loads via reverse proxy so X-Frame-Options is stripped */}
              <div className="flex-1 relative bg-white">
                <iframe
                  ref={iframeRef}
                  src={SEATTLE_PROXY_URL}
                  title="Seattle Parks tennis court search"
                  className="w-full h-full border-0"
                  allow="fullscreen"
                  referrerPolicy="no-referrer-when-downgrade"
                  onLoad={handleIframeLoad}
                />
              </div>
            </>
          )}
        </aside>

        {/* ── MAP (RIGHT) ── */}
        <div className="relative flex-1 h-full min-w-0">
          <div ref={mapRef} className="absolute inset-0" />

          {/* Map search — debounced Nominatim geocoder. Typing pans the map
              to the selected result, which fires moveend → scheduleFetch,
              so the courts auto-load for the new viewport. */}
          <div
            ref={searchBoxRef}
            className="absolute top-4 left-4 z-[460] w-72 max-w-[calc(100%-2rem)]"
          >
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => {
                  if (searchResults.length > 0 || courtResults.length > 0) setSearchOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setSearchOpen(false);
                    (e.target as HTMLInputElement).blur();
                  } else if (e.key === "Enter") {
                    // Courts take priority over places: typing "Bellevue" +
                    // Enter jumps to a Bellevue court rather than the city.
                    if (courtResults.length > 0) selectCourtResult(courtResults[0]);
                    else if (searchResults.length > 0) selectSearchResult(searchResults[0]);
                  }
                }}
                placeholder="Search city or place…"
                aria-label="Search for a city or place"
                className="w-full pl-9 pr-9 py-2 rounded-full bg-white shadow-md border border-gray-200 focus:border-court-green focus:outline-none focus:ring-2 focus:ring-court-green/20 text-sm"
              />
              {searchQuery && !searchLoading && (
                <button
                  onClick={clearSearch}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
              {searchLoading && (
                <svg
                  className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin w-4 h-4 text-court-green"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                  <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              )}
            </div>
            {searchOpen && (courtResults.length > 0 || searchResults.length > 0) && (
              <ul
                role="listbox"
                className="absolute top-full mt-1 left-0 right-0 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden max-h-80 overflow-y-auto"
              >
                {courtResults.length > 0 && (
                  <>
                    <li className="px-3 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide bg-gray-50/60">
                      Courts
                    </li>
                    {courtResults.map((c) => (
                      <li role="option" aria-selected="false" key={c.courtId}>
                        <button
                          onClick={() => selectCourtResult(c)}
                          className="w-full text-left px-3 py-2.5 hover:bg-court-green/5 text-xs text-gray-700 border-b border-gray-100 last:border-b-0 flex items-start gap-2"
                        >
                          <span
                            className="mt-0.5 flex-shrink-0 inline-flex items-center justify-center rounded-full text-[10px] leading-none"
                            style={{
                              width: 16,
                              height: 16,
                              background: BUCKET_MARKER_BG[c.bucket],
                              border: `2px solid ${BUCKET_MARKER_BORDER[c.bucket]}`,
                            }}
                            aria-hidden="true"
                          >
                            🎾
                          </span>
                          <span className="leading-snug min-w-0">
                            <span className="block font-semibold text-gray-800 truncate">
                              {c.name}
                            </span>
                            {(c.city || c.address) && (
                              <span className="block text-gray-500 truncate">
                                {c.city ?? c.address}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </>
                )}
                {searchResults.length > 0 && (
                  <>
                    <li className="px-3 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide bg-gray-50/60">
                      Places
                    </li>
                    {searchResults.map((r) => (
                      <li role="option" aria-selected="false" key={`${r.lat},${r.lon}`}>
                        <button
                          onClick={() => selectSearchResult(r)}
                          className="w-full text-left px-3 py-2.5 hover:bg-court-green/5 text-xs text-gray-700 border-b border-gray-100 last:border-b-0 flex items-start gap-2"
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            className="mt-0.5 flex-shrink-0 text-court-green"
                          >
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                            <circle cx="12" cy="10" r="3" />
                          </svg>
                          <span className="leading-snug">{r.displayName}</span>
                        </button>
                      </li>
                    ))}
                  </>
                )}
              </ul>
            )}
          </div>

          {/* Loading overlay */}
          {!mapReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-[400]">
              <div className="text-center">
                <svg className="animate-spin w-8 h-8 mx-auto text-court-green" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                  <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                <p className="text-xs text-gray-500 mt-2">Loading map…</p>
              </div>
            </div>
          )}

          {/* Fetching spinner */}
          {mapReady && fetching && (
            <div className="absolute top-4 right-4 z-[400] bg-white rounded-full shadow-md border border-court-green-pale/30 px-3 py-1.5 text-[11px] text-court-green font-semibold inline-flex items-center gap-1.5">
              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              Loading courts…
            </div>
          )}

          {/* Zoom hint */}
          {mapReady && zoomTooLow && !fetching && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[400] bg-white rounded-xl shadow-lg border border-court-green-pale/30 px-4 py-2 text-xs text-gray-600">
              Zoom in to see tennis courts
            </div>
          )}

          {/* Geo error */}
          {geoError && (
            <div
              className="absolute left-1/2 -translate-x-1/2 z-[400] bg-ball-yellow/20 border border-ball-yellow/40 rounded-xl px-4 py-2 text-xs text-court-green shadow-md"
              style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom) + 1rem)" }}
            >
              We couldn&apos;t get your location. Pan and zoom to explore.
            </div>
          )}

          {/* Load error */}
          {loadError && (
            <div
              className="absolute left-1/2 -translate-x-1/2 z-[400] bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-xs text-red-600 flex items-center gap-3 shadow-md"
              style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom) + 1rem)" }}
            >
              <span>{loadError}</span>
              <button onClick={() => runFetch()} className="px-2 py-1 rounded-md bg-red-100 hover:bg-red-200 text-red-700 text-[11px] font-semibold">
                Retry
              </button>
            </div>
          )}

          {/* Court count — reflects the active legend filter. */}
          {mapReady && courts.length > 0 && !selectedCourt && (() => {
            const visibleCount =
              bucketFilter === null
                ? courts.length
                : courts.filter(
                    (c) => c.source !== "osm" && (c.bucket ?? "city") === bucketFilter
                  ).length;
            return (
              <div
                className="absolute right-4 z-[400] bg-white rounded-full shadow-md border border-court-green-pale/30 px-3 py-1 text-[11px] text-gray-500"
                style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom) + 1rem)" }}
              >
                {visibleCount} court{visibleCount === 1 ? "" : "s"}
                {bucketFilter !== null && (
                  <span className="text-gray-400"> (filtered)</span>
                )}
              </div>
            );
          })()}

          {/* Marker color legend — also a category filter. Tap a row to show
              only that bucket; tap the active row again to clear. */}
          {mapReady && !selectedCourt && editingCourtId === null && (
            <div
              className="absolute left-4 z-[400] bg-white rounded-xl shadow-md border border-court-green-pale/30 px-2.5 py-2"
              style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom) + 1rem)" }}
            >
              <ul className="flex flex-col gap-1">
                {(
                  [
                    { bucket: "city", label: "Cities & parks" },
                    { bucket: "club", label: "Clubs" },
                    { bucket: "school", label: "Schools" },
                  ] as const
                ).map(({ bucket, label }) => {
                  const active = bucketFilter === bucket;
                  const dimmed = bucketFilter !== null && !active;
                  return (
                    <li key={bucket}>
                      <button
                        type="button"
                        onClick={() =>
                          setBucketFilter((cur) => (cur === bucket ? null : bucket))
                        }
                        aria-pressed={active}
                        className={`flex items-center gap-2 text-[11px] leading-none w-full text-left rounded-md px-1.5 py-1 -mx-1.5 transition-colors ${
                          active
                            ? "bg-court-green-pale/40 text-court-green font-semibold"
                            : dimmed
                              ? "text-gray-400 hover:bg-gray-50"
                              : "text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        <span
                          style={{
                            background: BUCKET_MARKER_BG[bucket],
                            border: `2px solid ${BUCKET_MARKER_BORDER[bucket]}`,
                          }}
                          className="inline-block w-3 h-3 rounded-full flex-shrink-0"
                          aria-hidden="true"
                        />
                        {label}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {bucketFilter !== null && (
                <button
                  type="button"
                  onClick={() => setBucketFilter(null)}
                  className="mt-1 w-full text-left text-[10px] font-medium text-court-green hover:text-court-green-light"
                >
                  Show all
                </button>
              )}
              <button
                type="button"
                onClick={() => setAddCourtOpen(true)}
                className="mt-2 pt-2 border-t border-gray-100 w-full text-left text-[11px] font-medium text-court-green hover:text-court-green-light"
              >
                + Missing a court? Report it
              </button>
            </div>
          )}

          {/* Report-a-missing-court modal (opens from the legend link). */}
          {addCourtOpen && (
            <AddMissingCourtModal
              myLocation={myLocation}
              onClose={() => setAddCourtOpen(false)}
            />
          )}

          {/* Google-Maps-style slide-up card for the tapped pin */}
          {selectedCourt && editingCourtId === null && (
            <CourtSummaryCard
              courtId={selectedCourt.id}
              name={selectedCourt.name}
              address={selectedCourt.address}
              details={courtDetailLine(selectedCourt)}
              lat={selectedCourt.lat}
              lng={selectedCourt.lng}
              summary={summaries[selectedCourt.id] ?? null}
              category={selectedCourt.category}
              bookingUrl={selectedCourt.bookingUrl ?? null}
              descriptionPreview={selectedCourt.descriptionPreview ?? null}
              status={selectedCourt.status}
              editable={IS_DEV && selectedCourt.source === "facility"}
              onEditPin={beginEditPin}
              mapView={mapView}
              myLocation={myLocation}
              onClose={() => setSelectedCourtId(null)}
            />
          )}

          {/* Dev-only: drag-to-edit toolbar. Visible only when a pin is in
              edit mode. Replaces the summary card while editing. */}
          {IS_DEV && editingCourtId !== null && editDraft && (
            <div
              className="absolute left-0 right-0 z-[470] pointer-events-none"
              style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom))" }}
            >
              <div className="mx-auto w-full sm:max-w-md pointer-events-auto">
                <div className="bg-white rounded-t-2xl sm:rounded-2xl sm:mb-4 sm:mx-4 shadow-2xl border-2 border-amber-300 overflow-hidden">
                  <div className="px-4 pt-3 pb-3">
                    <div className="flex items-baseline justify-between gap-3 mb-2">
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">
                          Editing pin
                        </p>
                        <h3 className="font-display font-bold text-court-green text-sm leading-tight truncate">
                          {courtsMapRef.current.get(editingCourtId)?.name ?? editingCourtId}
                        </h3>
                      </div>
                      <code className="text-[11px] text-gray-600 font-mono flex-shrink-0">
                        {editDraft.lat.toFixed(6)}, {editDraft.lng.toFixed(6)}
                      </code>
                    </div>
                    <p className="text-[11px] text-gray-500 mb-3">
                      Drag the highlighted pin on the map. Click Save when it&apos;s right.
                    </p>
                    {editError && (
                      <p className="text-xs text-red-600 mb-2">{editError}</p>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={cancelEditPin}
                        disabled={editSaving}
                        className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-medium text-gray-700 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={saveEditPin}
                        disabled={editSaving}
                        className="px-3 py-2 rounded-lg bg-court-green hover:bg-court-green-light text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {editSaving ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function courtDetailLine(c: CourtData): string {
  const bits: string[] = [];
  if (c.courts && c.courts > 0) bits.push(`${c.courts} court${c.courts === 1 ? "" : "s"}`);
  if (c.surface) bits.push(c.surface);
  if (c.lit) bits.push("lit");
  return bits.join(" · ");
}

