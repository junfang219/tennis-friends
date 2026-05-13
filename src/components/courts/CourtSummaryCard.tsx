"use client";

import Link from "next/link";
import { StarRating } from "./StarRating";

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
  onClose: () => void;
};

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
  onClose,
}: Props) {
  const hasReviews = (summary?.count ?? 0) > 0;
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  const detailHref = `/courts/${encodeURIComponent(courtId)}`;

  return (
    <div className="absolute left-0 right-0 bottom-0 z-[470] pointer-events-none">
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
            <div className="mt-4 grid grid-cols-2 gap-2">
              <a
                href={directionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-medium text-gray-700"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                Directions
              </a>
              <Link
                href={detailHref}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-court-green hover:bg-court-green-light text-sm font-semibold text-white"
              >
                {hasReviews ? "See all reviews" : "Write a review"}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
