"use client";

import { DirectionsButton } from "@/components/courts/DirectionsButton";
import { resolveFacilityByName } from "@/lib/facilities";

/** Tappable 📍 location line for match/practice cards: opens the Apple/Google
 *  Maps chooser, pinned to the catalog facility when the free-text venue name
 *  resolves (falls back to a maps search on the raw text). stopPropagation so
 *  it works inside clickable cards / <Link>s — same pattern PersonalEventCard
 *  established on the calendar page. */
export function LocationDirections({
  location,
  className = "flex items-center gap-1 text-court-green font-medium hover:underline truncate max-w-[12rem]",
}: {
  location: string;
  className?: string;
}) {
  const facility = resolveFacilityByName(location);
  const hasCoords = facility?.latitude != null && facility?.longitude != null;
  return (
    <span onClick={(e) => e.stopPropagation()} className="min-w-0">
      <DirectionsButton
        lat={hasCoords ? facility!.latitude! : undefined}
        lng={hasCoords ? facility!.longitude! : undefined}
        query={hasCoords ? undefined : location}
        destinationLabel={
          facility ? `${facility.name}${facility.address ? `, ${facility.address}` : ""}` : location
        }
        ariaLabel={`Directions to ${location}`}
        className={className}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
        <span className="truncate">{location}</span>
      </DirectionsButton>
    </span>
  );
}
