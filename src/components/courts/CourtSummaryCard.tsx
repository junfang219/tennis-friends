"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { StarRating } from "./StarRating";
import { DirectionsButton } from "./DirectionsButton";
import { CourtStatusReporter } from "./CourtStatusReporter";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export type CourtSummary = {
  avg: number;
  count: number;
  thumbs: string[];
};

type Props = {
  courtId: string;
  name: string;
  address?: string;
  details?: string; // e.g. "6 courts · hard · lit"
  lat: number;
  lng: number;
  summary: CourtSummary | null;
  /** Facility category from the scraped dataset; drives the small chip. */
  category?: string;
  /** Direct booking URL when the venue is reservable online. */
  bookingUrl?: string | null;
  /** Short first-sentence preview from `description`. */
  descriptionPreview?: string | null;
  /** "temporarily_closed" → red status chip. */
  status?: "active" | "temporarily_closed";
  /** Dev-only: show the "Edit pin" affordance. */
  editable?: boolean;
  /** Called when the user clicks "Edit pin"; parent flips the map into edit mode. */
  onEditPin?: () => void;
  /** Current map center + zoom. Encoded into the Details link so the detail
   *  page can pass it back, letting `/courts` restore the user's exact view
   *  instead of jumping to street-level. */
  mapView?: { lat: number; lng: number; zoom: number } | null;
  /** User's current geolocation. When set, the chosen map app opens with
   *  the route already drawn instead of prompting "from where?". */
  myLocation?: { lat: number; lng: number } | null;
  onClose: () => void;
};

// Lowercase enum → display label.
const CATEGORY_LABEL: Record<string, string> = {
  public_park: "Public park",
  school: "School",
  private_club: "Private club",
  hoa_community: "HOA / residents",
  college: "College",
  indoor_facility: "Indoor facility",
};

// Categories where players crowd-source empty-court reports on arrival.
const REPORT_ELIGIBLE_CATEGORIES = new Set(["public_park", "school", "college"]);

type RecentReportsSummary = {
  count: number;
  emptyCount: number;
  lastReportedAt: string | null;
};

function formatClock(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Slide-up panel anchored to the bottom of the map. Mimics Google Maps' POI
// preview: name, rating + count, photo strip, and quick actions.
export function CourtSummaryCard({
  courtId,
  name,
  address,
  details,
  lat,
  lng,
  summary,
  category,
  bookingUrl,
  descriptionPreview,
  status,
  editable,
  onEditPin,
  mapView,
  myLocation,
  onClose,
}: Props) {
  const hasReviews = (summary?.count ?? 0) > 0;
  const eligibleForReports = !!category && REPORT_ELIGIBLE_CATEGORIES.has(category);
  const [recentReports, setRecentReports] = useState<RecentReportsSummary | null>(null);

  const refreshReports = useCallback(async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("court_availability_reports")
        .select("has_empty, reported_at")
        .eq("court_id", courtId)
        .gte("reported_at", sinceIso);
      const rows = (data ?? []) as Array<{ has_empty: boolean; reported_at: string }>;
      if (rows.length === 0) {
        setRecentReports(null);
        return;
      }
      // Roll up: how many reported empty courts in the last hour.
      let emptyCount = 0;
      for (const r of rows) {
        if (r.has_empty) emptyCount += 1;
      }
      const latest = rows.reduce((acc, r) =>
        r.reported_at > acc.reported_at ? r : acc
      );
      setRecentReports({
        count: rows.length,
        emptyCount,
        lastReportedAt: latest.reported_at,
      });
    } catch {
      // ignore
    }
  }, [courtId]);

  useEffect(() => {
    if (!eligibleForReports) {
      setRecentReports(null);
      return;
    }
    void refreshReports();
  }, [eligibleForReports, refreshReports]);
  // Encode the user's current map view into the Details link so the detail
  // page can pass it back via the breadcrumb — preserves zoom level on
  // return (city → city, street → street).
  const detailHref = mapView
    ? `/courts/${encodeURIComponent(courtId)}?z=${mapView.zoom}&lat=${mapView.lat.toFixed(6)}&lng=${mapView.lng.toFixed(6)}`
    : `/courts/${encodeURIComponent(courtId)}`;

  return (
    <div
      className="absolute left-0 right-0 z-[470] pointer-events-none"
      style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto w-full sm:max-w-md pointer-events-auto">
        <div className="bg-white rounded-t-2xl sm:rounded-2xl sm:mb-4 sm:mx-4 shadow-2xl border border-gray-100 overflow-hidden animate-slideup">
          {/* Drag handle (visual cue) */}
          <div className="flex justify-center pt-2 sm:hidden">
            <div className="w-10 h-1 rounded-full bg-gray-300" />
          </div>

          <div className="px-4 pt-3 pb-4">
            {/* Header row */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-display font-bold text-court-green text-lg leading-tight truncate">
                  {name}
                </h3>
                {address && (
                  <p className="text-xs text-gray-500 truncate mt-0.5">{address}</p>
                )}
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  {hasReviews ? (
                    <>
                      <span className="text-sm font-semibold text-gray-800">
                        {summary!.avg.toFixed(1)}
                      </span>
                      <StarRating value={summary!.avg} size={14} />
                      <span className="text-xs text-gray-500">
                        ({summary!.count})
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-gray-400">No reviews yet</span>
                  )}
                  {details && (
                    <span className="text-xs text-gray-400 before:content-['·'] before:mx-1">
                      {details}
                    </span>
                  )}
                </div>

                {/* Chips: category + closed status */}
                {(category || status === "temporarily_closed") && (
                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                    {category && CATEGORY_LABEL[category] && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[10px] font-medium uppercase tracking-wide">
                        {CATEGORY_LABEL[category]}
                      </span>
                    )}
                    {status === "temporarily_closed" && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-semibold uppercase tracking-wide">
                        Temporarily closed
                      </span>
                    )}
                  </div>
                )}

                {/* Description preview (truncated to one short line) */}
                {descriptionPreview && (
                  <p className="mt-2 text-xs text-gray-600 line-clamp-2 leading-snug">
                    {descriptionPreview}
                  </p>
                )}

                {/* Recent empty-court reports — crowd-sourced, last 60 min */}
                {recentReports &&
                  recentReports.emptyCount > 0 &&
                  recentReports.lastReportedAt && (
                    <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-50 text-amber-800 text-[11px] font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      <span>
                        {recentReports.emptyCount === 1
                          ? "1 player reported empty courts"
                          : `${recentReports.emptyCount} players reported empty courts`}
                        {" · "}
                        last at {formatClock(recentReports.lastReportedAt)}
                      </span>
                    </div>
                  )}
              </div>
              <button
                onClick={onClose}
                className="-mt-1 -mr-1 w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center flex-shrink-0"
                aria-label="Close"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Photo strip */}
            {summary && summary.thumbs.length > 0 && (
              <Link
                href={detailHref}
                className="mt-3 flex gap-1.5 overflow-x-auto rounded-xl"
              >
                {summary.thumbs.map((url, i) => (
                  <div
                    key={url + i}
                    className="w-24 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </div>
                ))}
              </Link>
            )}

            {/* Action row */}
            <div
              className={`mt-4 grid gap-2 ${
                bookingUrl ? "grid-cols-3" : "grid-cols-2"
              }`}
            >
              <DirectionsButton
                lat={lat}
                lng={lng}
                myLocation={myLocation}
                destinationLabel={address ?? name}
                className="flex items-center justify-center gap-1 px-2 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs sm:text-sm font-medium text-gray-700"
                ariaLabel={`Get directions to ${name}`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                Directions
              </DirectionsButton>
              {bookingUrl && (
                <a
                  href={bookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1 px-2 py-2 rounded-lg bg-ball-yellow/30 hover:bg-ball-yellow/50 text-xs sm:text-sm font-semibold text-amber-800"
                  aria-label="Book this court"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  Book
                </a>
              )}
              <Link
                href={detailHref}
                className="flex items-center justify-center gap-1 px-2 py-2 rounded-lg bg-court-green hover:bg-court-green-light text-xs sm:text-sm font-semibold text-white"
              >
                Details
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>
            </div>

            {/* Crowd-sourced status reporter — single on-tap GPS check, no
                background polling. Only on report-eligible categories. */}
            {eligibleForReports && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <CourtStatusReporter
                  courtId={courtId}
                  venueName={name}
                  lat={lat}
                  lng={lng}
                  variant="card"
                  onReported={refreshReports}
                />
              </div>
            )}

            {/* Dev-only: drag-to-edit affordance. The parent flips the map
                into edit mode for this pin; we close the card to give the
                user a clear drag surface. */}
            {editable && onEditPin && (
              <button
                onClick={() => {
                  onEditPin();
                  onClose();
                }}
                className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border border-dashed border-gray-300 text-[11px] font-medium text-gray-500 hover:bg-gray-50"
                aria-label="Edit pin location"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                Edit pin (dev)
              </button>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
