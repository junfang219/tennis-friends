"use client";

// Real-time availability lookup is gated on the ActiveNet scraper +
// /api/courts/availability route — both deleted in the
// Prisma→Supabase burn-down and not yet restored. Renders a clearly-
// labelled "in progress" placeholder. The previous version 404'd
// against the dead endpoint and showed a generic "Couldn't load
// availability" forever. Restore the full grid by reinstating the
// scraper Edge Function and re-fetching here.

interface TimeSlot {
  courtName: string;
  startTime: string;
  endTime: string;
  available: boolean;
  bookingUrl: string;
}

interface AvailabilityGridProps {
  venueId: string;
  venueName: string;
  date: string;
  onBook?: (slot: TimeSlot) => void;
}

export default function AvailabilityGrid({ venueName }: AvailabilityGridProps) {
  return (
    <div className="bg-white rounded-xl border border-amber-100 p-4">
      <div className="flex items-start gap-3">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-amber-600 flex-shrink-0 mt-0.5"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div className="text-sm text-amber-800">
          <p className="font-semibold">Real-time availability is in progress.</p>
          <p className="mt-1 text-xs text-amber-700/80">
            We&apos;ll show empty courts and live booking links for{" "}
            {venueName} here once the integration is back online. For now,
            check directly via Seattle Parks.
          </p>
        </div>
      </div>
    </div>
  );
}
