"use client";

// "Find open courts" filter for the courts map. The user picks a bookable date
// and a time window (presets or a custom From–To), and we query
// /api/courts/available (snapshot-backed) for every Seattle Parks venue with a
// matching open court. Results render as a slide-up list; the parent map dims
// its pins to the matching venues via onMatchesChange.

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  type Preset,
  PRESET_RANGES,
  PRESET_LABELS,
  HOUR_OPTIONS,
  hourLabel,
} from "@/lib/courtTimePresets";

interface VenueMatch {
  courtId: string;
  centerId: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
  courtCount: number;
  startMin: number;
  endMin: number;
}

interface AvailabilityFinderProps {
  myLocation: { lat: number; lng: number } | null;
  mapView: { zoom: number; lat: number; lng: number } | null;
  /** Matching court IDs to keep on the map, or null to clear the filter. */
  onMatchesChange: (ids: Set<string> | null) => void;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** The 14 bookable dates: tomorrow through +14 (today is same-day, not bookable). */
function bookableDays(): { value: string; weekday: string; md: string }[] {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + 1 + i);
    return {
      value: ymd(d),
      weekday: d.toLocaleDateString([], { weekday: "short" }),
      md: d.toLocaleDateString([], { month: "numeric", day: "numeric" }),
    };
  });
}

function clock(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}` : `${h12}:${String(m).padStart(2, "0")}`;
}
function ampm(min: number): string {
  return min < 720 || min === 1440 ? "a" : "p";
}
function formatSpan(startMin: number, endMin: number): string {
  return ampm(startMin) === ampm(endMin)
    ? `${clock(startMin)}–${clock(endMin)}${ampm(endMin)}`
    : `${clock(startMin)}${ampm(startMin)}–${clock(endMin)}${ampm(endMin)}`;
}

function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default function AvailabilityFinder({
  myLocation,
  mapView,
  onMatchesChange,
}: AvailabilityFinderProps) {
  const [days] = useState(bookableDays);
  const [panelOpen, setPanelOpen] = useState(false);
  const [date, setDate] = useState(() => days[0]?.value ?? "");
  const [preset, setPreset] = useState<Preset>("any");
  const [customStart, setCustomStart] = useState("17:00");
  const [customEnd, setCustomEnd] = useState("20:00");
  const [results, setResults] = useState<VenueMatch[] | null>(null);
  // The date/range actually searched, carried into each result's detail link
  // so the court page opens on that day with the window highlighted.
  const [applied, setApplied] = useState<{
    date: string;
    start: string | null;
    end: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const search = useCallback(async () => {
    setLoading(true);
    setError(false);
    const [ps, pe] = preset === "custom" ? [customStart, customEnd] : PRESET_RANGES[preset];
    const params = new URLSearchParams({ date });
    if (ps) params.set("start", ps);
    if (pe) params.set("end", pe);
    try {
      const res = await fetch(`/api/courts/available?${params.toString()}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { venues: VenueMatch[] };
      const venues = data.venues;
      if (myLocation) {
        venues.sort((a, b) => {
          const da =
            a.latitude != null && a.longitude != null
              ? haversineMiles(myLocation, { lat: a.latitude, lng: a.longitude })
              : Infinity;
          const db =
            b.latitude != null && b.longitude != null
              ? haversineMiles(myLocation, { lat: b.latitude, lng: b.longitude })
              : Infinity;
          return da - db;
        });
      }
      setResults(venues);
      setApplied({ date, start: ps, end: pe });
      setPanelOpen(false);
      onMatchesChange(new Set(venues.map((v) => v.courtId)));
    } catch {
      setError(true);
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, [date, preset, customStart, customEnd, myLocation, onMatchesChange]);

  const clear = useCallback(() => {
    setResults(null);
    setError(false);
    onMatchesChange(null);
  }, [onMatchesChange]);

  const detailHref = useCallback(
    (courtId: string) => {
      const params = new URLSearchParams();
      if (mapView) {
        params.set("z", String(mapView.zoom));
        params.set("lat", mapView.lat.toFixed(6));
        params.set("lng", mapView.lng.toFixed(6));
      }
      if (applied) {
        params.set("date", applied.date);
        if (applied.start) params.set("start", applied.start);
        if (applied.end) params.set("end", applied.end);
      }
      const qs = params.toString();
      return `/courts/${encodeURIComponent(courtId)}${qs ? `?${qs}` : ""}`;
    },
    [mapView, applied]
  );

  const selectedDay = days.find((d) => d.value === date);
  const presetLabel = PRESET_LABELS.find((p) => p.key === preset)?.label ?? "Any time";
  const summary = selectedDay
    ? `${selectedDay.weekday} ${selectedDay.md} · ${
        preset === "custom" ? `${hourLabel(+customStart.slice(0, 2))}–${hourLabel(+customEnd.slice(0, 2))}` : presetLabel
      }`
    : "Find open courts";

  return (
    <>
      {/* Trigger pill — stacked just below the top-left search box */}
      <div className="absolute top-16 left-4 z-[480] flex items-center gap-2">
        <button
          onClick={() => setPanelOpen((o) => !o)}
          className="flex items-center gap-2 rounded-full bg-court-green text-white shadow-md px-4 py-2 text-sm font-semibold hover:bg-court-green-light transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          {results ? `${results.length} open` : "Find open courts"}
        </button>
        {results && (
          <button
            onClick={clear}
            aria-label="Clear availability filter"
            className="rounded-full bg-white shadow-md w-8 h-8 flex items-center justify-center text-gray-500 hover:bg-gray-100"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Filter panel */}
      {panelOpen && (
        <div className="absolute top-28 left-4 z-[480] w-[22rem] max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-xl border border-gray-100 p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Date</p>
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            {days.map((d) => (
              <button
                key={d.value}
                onClick={() => setDate(d.value)}
                className={`flex flex-col items-center shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  d.value === date
                    ? "bg-court-green text-white"
                    : "bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200"
                }`}
              >
                <span>{d.weekday}</span>
                <span className={d.value === date ? "text-white/90" : "text-gray-400"}>{d.md}</span>
              </button>
            ))}
          </div>

          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-3 mb-2">Time</p>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_LABELS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPreset(p.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  preset === p.key
                    ? "bg-court-green text-white"
                    : "bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {preset === "custom" && (
            <div className="flex items-center gap-2 mt-3">
              <Select value={customStart} onChange={setCustomStart} />
              <span className="text-gray-400 text-sm">to</span>
              <Select value={customEnd} onChange={setCustomEnd} />
            </div>
          )}

          <button
            onClick={search}
            disabled={loading}
            className="mt-4 w-full rounded-lg bg-court-green text-white py-2.5 text-sm font-semibold hover:bg-court-green-light transition-colors disabled:opacity-60"
          >
            {loading ? "Searching…" : "Show open courts"}
          </button>
        </div>
      )}

      {/* Results list — slide-up sheet */}
      {results && !panelOpen && (
        <div className="absolute bottom-0 inset-x-0 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-96 z-[470] bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-100 max-h-[55vh] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {results.length} venue{results.length === 1 ? "" : "s"} with open courts
              </p>
              <p className="text-[11px] text-gray-400">{summary}</p>
            </div>
            <button
              onClick={clear}
              className="text-xs font-semibold text-court-green hover:underline shrink-0"
            >
              Clear
            </button>
          </div>
          <div className="overflow-y-auto">
            {results.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-400">
                No open courts match — try another time or date.
              </p>
            ) : (
              results.map((v) => {
                const miles =
                  myLocation && v.latitude != null && v.longitude != null
                    ? haversineMiles(myLocation, { lat: v.latitude, lng: v.longitude })
                    : null;
                return (
                  <Link
                    key={v.courtId}
                    href={detailHref(v.courtId)}
                    className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{v.name}</p>
                      <p className="text-xs text-gray-500">
                        {v.courtCount} court{v.courtCount === 1 ? "" : "s"} open ·{" "}
                        <span className="text-court-green font-medium">
                          {formatSpan(v.startMin, v.endMin)}
                        </span>
                        {miles != null && <span className="text-gray-400"> · {miles.toFixed(1)} mi</span>}
                      </p>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-gray-300 shrink-0">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      )}

      {error && !panelOpen && (
        <div className="absolute top-28 left-4 z-[480] bg-white rounded-lg shadow-md border border-red-200 px-4 py-2 text-sm text-red-600">
          Couldn&apos;t load availability.{" "}
          <button onClick={search} className="font-semibold underline">
            Retry
          </button>
        </div>
      )}
    </>
  );
}

function Select({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-court-green/20"
    >
      {HOUR_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
