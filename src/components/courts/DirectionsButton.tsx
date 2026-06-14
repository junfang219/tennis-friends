"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = {
  /** Destination coordinates. Preferred when available (exact pin). */
  lat?: number;
  lng?: number;
  /** Place/address string — used when lat/lng aren't known (free-text venue). */
  query?: string;
  /** Shown as a subtitle in the action sheet so the user knows where they're heading. */
  destinationLabel?: string;
  /** When set, included as the route origin so the map app skips the "from where?" prompt. */
  myLocation?: { lat: number; lng: number } | null;
  /** Styling for the trigger button — caller controls layout (pill, inline link, etc). */
  className?: string;
  /** Trigger contents (icon + label). */
  children: ReactNode;
  ariaLabel?: string;
};

/** Coordinates win (exact pin); otherwise route to the place/address text. */
function destString(lat?: number, lng?: number, query?: string): string {
  if (typeof lat === "number" && typeof lng === "number") return `${lat},${lng}`;
  return query ?? "";
}

function googleMapsUrl(dest: string, origin?: { lat: number; lng: number } | null): string {
  const params = new URLSearchParams({ api: "1" });
  if (origin) params.set("origin", `${origin.lat},${origin.lng}`);
  params.set("destination", dest);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function appleMapsUrl(dest: string): string {
  // Apple's Maps URL Scheme — daddr is destination, dirflg=d requests driving
  // directions. We deliberately omit saddr: when the origin is left out Apple
  // Maps routes from the device's *live* current location and offers the green
  // "GO" turn-by-turn button. Passing explicit saddr coordinates makes it treat
  // the trip as between two fixed points and only shows the "Steps" overview.
  const params = new URLSearchParams();
  params.set("daddr", dest);
  params.set("dirflg", "d");
  return `https://maps.apple.com/?${params.toString()}`;
}

export function DirectionsButton({
  lat,
  lng,
  query,
  destinationLabel,
  myLocation,
  className,
  children,
  ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const dest = destString(lat, lng, query);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
        aria-label={ariaLabel ?? "Get directions"}
      >
        {children}
      </button>
      {open && (
        <DirectionsSheet
          appleUrl={appleMapsUrl(dest)}
          googleUrl={googleMapsUrl(dest, myLocation)}
          destinationLabel={destinationLabel}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function DirectionsSheet({
  appleUrl,
  googleUrl,
  destinationLabel,
  onClose,
}: {
  appleUrl: string;
  googleUrl: string;
  destinationLabel?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  // Portaled to body so the sheet escapes CourtSummaryCard's outer
  // `pointer-events: none` wrapper (taps inside the map fall through to
  // the map by default; the sheet must opt back in).
  return createPortal(
    <div
      className="fixed inset-0 z-[600] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="directions-sheet-title"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="px-4 pt-4 pb-2">
          <h3 id="directions-sheet-title" className="text-sm font-semibold text-gray-900">
            Open directions in…
          </h3>
          {destinationLabel && (
            <p className="text-[11px] text-gray-500 truncate mt-0.5">{destinationLabel}</p>
          )}
        </div>
        <div className="px-3 pb-3 pt-1 grid gap-2">
          <a
            href={appleUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="flex items-center justify-between gap-3 px-3 py-3 rounded-xl bg-gray-50 hover:bg-gray-100 active:bg-gray-200"
          >
            <span className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-700">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </span>
              <span className="text-sm font-medium text-gray-900">Apple Maps</span>
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-gray-400">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </a>
          <a
            href={googleUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="flex items-center justify-between gap-3 px-3 py-3 rounded-xl bg-gray-50 hover:bg-gray-100 active:bg-gray-200"
          >
            <span className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-700">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </span>
              <span className="text-sm font-medium text-gray-900">Google Maps</span>
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-gray-400">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </a>
        </div>
        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full px-3 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-sm font-medium text-gray-700"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
