"use client";

import { useEffect, useRef, useState, useCallback } from "react";

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
  source: "official" | "osm";
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

function ensureLeaflet(): Promise<Leaflet> {
  return new Promise((resolve) => {
    const existing = getLeaflet();
    if (existing) return resolve(existing);
    if (!document.querySelector('link[data-leaflet]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      link.setAttribute("data-leaflet", "1");
      document.head.appendChild(link);
    }
    const existingScript = document.querySelector('script[data-leaflet]');
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(getLeaflet()));
      return;
    }
    const s = document.createElement("script");
    s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    s.async = true;
    s.setAttribute("data-leaflet", "1");
    s.onload = () => resolve(getLeaflet());
    document.head.appendChild(s);
  });
}

export default function CourtsPage() {
  const [courts, setCourts] = useState<CourtData[]>([]);
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [fetching, setFetching] = useState(false);
  const [zoomTooLow, setZoomTooLow] = useState(false);

  // Seattle Parks side panel (open by default on desktop)
  const [sidePanelOpen, setSidePanelOpen] = useState(true);

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
  const fetchTokenRef = useRef(0);
  const courtsMapRef = useRef<Map<string, CourtData>>(new Map());

  const runFetch = useCallback(async () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (map.getZoom() < MIN_FETCH_ZOOM) {
      setZoomTooLow(true);
      return;
    }
    setZoomTooLow(false);
    const b = map.getBounds();
    const params = new URLSearchParams({
      south: b.getSouth().toFixed(6),
      west: b.getWest().toFixed(6),
      north: b.getNorth().toFixed(6),
      east: b.getEast().toFixed(6),
    });
    const token = ++fetchTokenRef.current;
    setFetching(true);
    setLoadError("");
    try {
      const res = await fetch(`/api/courts?${params}`);
      if (!res.ok) throw new Error("Failed");
      const data: CourtData[] = await res.json();
      if (token !== fetchTokenRef.current) return;
      for (const c of data) courtsMapRef.current.set(c.id, c);
      setCourts(Array.from(courtsMapRef.current.values()));
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
      map.on("moveend", () => scheduleFetch());
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

  // Geolocation
  useEffect(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setGeoError(true);
      return;
    }
    const timer = setTimeout(() => setGeoError(true), 8000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        setMyLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoError(false);
      },
      () => { clearTimeout(timer); setGeoError(true); },
      { enableHighAccuracy: false, timeout: 7000, maximumAge: 60_000 }
    );
    return () => clearTimeout(timer);
  }, []);

  // Recenter on user
  useEffect(() => {
    if (!mapReady || !myLocation) return;
    const L = getLeaflet();
    const map = mapInstanceRef.current;
    if (!L || !map) return;
    map.setView([myLocation.lat, myLocation.lng], 13);
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
  }, [mapReady, myLocation]);

  // Render court markers
  useEffect(() => {
    if (!mapReady) return;
    const L = getLeaflet();
    const map = mapInstanceRef.current;
    if (!L || !map) return;

    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    const courtIcon = L.divIcon({
      className: "",
      html: `<div style="width:22px;height:22px;background:#C9E265;border:3px solid #2D6A4F;border-radius:9999px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.25);font-size:11px;cursor:pointer">🎾</div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });

    for (const c of courts) {
      const marker = L.marker([c.lat, c.lng], { icon: courtIcon }).addTo(map);
      const safeName = escapeHtml(c.name);

      const detailBits: string[] = [];
      if (c.courts && c.courts > 0) detailBits.push(`${c.courts} court${c.courts === 1 ? "" : "s"}`);
      if (c.surface) detailBits.push(escapeHtml(c.surface));
      if (c.lit) detailBits.push("lit");
      const detailLine = detailBits.length
        ? `<div style="color:#6b7280;font-size:11px;margin-top:2px">${detailBits.join(" · ")}</div>`
        : "";
      const addressLine = c.address
        ? `<div style="color:#9ca3af;font-size:11px;margin-top:2px">${escapeHtml(c.address)}</div>`
        : "";
      const accessLine = c.access && c.access !== "yes" && c.access !== "public"
        ? `<div style="color:#b45309;font-size:11px;margin-top:2px">access: ${escapeHtml(c.access)}</div>`
        : "";
      const osmLine = c.source === "osm"
        ? `<div style="margin-top:4px"><a href="https://www.openstreetmap.org/${c.type}/${c.osmId}" target="_blank" rel="noopener noreferrer" style="color:#9ca3af;font-size:10px">View on OSM ↗</a></div>`
        : "";

      marker.bindPopup(
        `<div style="min-width:180px"><b style="font-size:13px">${safeName}</b>${detailLine}${addressLine}${accessLine}${osmLine}</div>`
      );

      markersRef.current.push(marker);
    }
  }, [courts, mapReady]);

  return (
    <div className="relative w-full" style={{ height: "calc(100vh - 64px)" }}>
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
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-court-green text-white flex-shrink-0">
                <div className="min-w-0 flex-1">
                  <h2 className="font-display font-bold text-sm truncate">Book on Seattle Parks</h2>
                  <p className="text-[11px] text-white/70 truncate">
                    Enter a date &amp; time, then tap a court to book
                  </p>
                </div>
                <button
                  onClick={() => setSidePanelOpen(false)}
                  className="ml-3 w-7 h-7 rounded-full hover:bg-white/20 flex items-center justify-center flex-shrink-0"
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

          {/* Reopen side panel button (only when closed) */}
          {!sidePanelOpen && (
            <button
              onClick={() => setSidePanelOpen(true)}
              className="absolute top-4 left-4 z-[450] flex items-center gap-2 px-3 py-2 bg-court-green text-white text-xs font-semibold rounded-lg shadow-lg hover:bg-court-green-light transition-colors"
              title="Open Seattle Parks booking"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <polyline points="3 6 21 6" />
                <polyline points="3 18 21 18" />
              </svg>
              Book on Seattle Parks
            </button>
          )}

          {/* Zoom hint */}
          {mapReady && zoomTooLow && !fetching && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[400] bg-white rounded-xl shadow-lg border border-court-green-pale/30 px-4 py-2 text-xs text-gray-600">
              Zoom in to see tennis courts
            </div>
          )}

          {/* Geo error */}
          {geoError && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[400] bg-ball-yellow/20 border border-ball-yellow/40 rounded-xl px-4 py-2 text-xs text-court-green shadow-md">
              We couldn&apos;t get your location. Pan and zoom to explore.
            </div>
          )}

          {/* Load error */}
          {loadError && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[400] bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-xs text-red-600 flex items-center gap-3 shadow-md">
              <span>{loadError}</span>
              <button onClick={() => runFetch()} className="px-2 py-1 rounded-md bg-red-100 hover:bg-red-200 text-red-700 text-[11px] font-semibold">
                Retry
              </button>
            </div>
          )}

          {/* Court count */}
          {mapReady && courts.length > 0 && (
            <div className="absolute bottom-4 right-4 z-[400] bg-white rounded-full shadow-md border border-court-green-pale/30 px-3 py-1 text-[11px] text-gray-500">
              {courts.length} court{courts.length === 1 ? "" : "s"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
