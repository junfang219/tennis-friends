"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getCurrentPosition, isPositionError } from "@/lib/getCurrentPosition";
import { distanceMeters } from "@/lib/haversine";

// Manual "is there an open court right now?" reporter. Replaces the old
// background GPS arrival detector: instead of polling location every 90s,
// we read the user's position exactly once — when they tap a button — and
// only accept the report if they're physically at the venue. This keeps the
// crowd-sourced data trustworthy without any continuous location tracking.
//
// Reports go through the same report_court_availability RPC as before, but
// with no p_post_id (no game context). The RPC dedupes per user + court
// within 30 minutes, so spamming the buttons is a no-op.

// Max distance from the venue we'll accept a report from. Generous enough to
// absorb consumer-GPS jitter (a court complex can span ~100m) without letting
// someone report from across town.
const PROXIMITY_M = 150;

type Props = {
  courtId: string;
  venueName: string;
  /** Venue coordinates — required to verify the reporter is on-site. */
  lat: number | null;
  lng: number | null;
  /** "card" = compact (map summary), "detail" = full-width (detail page). */
  variant?: "card" | "detail";
  /** Fired after a successful report so the parent can refresh its banner. */
  onReported?: () => void;
};

function formatDistance(meters: number): string {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1)} km`
    : `${Math.round(meters)} m`;
}

export function CourtStatusReporter({
  courtId,
  venueName,
  lat,
  lng,
  variant = "card",
  onReported,
}: Props) {
  const [submitting, setSubmitting] = useState<"yes" | "no" | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Without coordinates we can't verify on-site presence, so don't offer it.
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  async function submit(hasEmpty: boolean) {
    setSubmitting(hasEmpty ? "yes" : "no");
    setError(null);
    try {
      // Single on-demand location read — never polled in the background.
      const pos = await getCurrentPosition();
      if (isPositionError(pos)) {
        setError(
          pos.code === "permission_denied"
            ? "Enable location to report — we check it once to confirm you're at the court."
            : "Couldn't get your location. Please try again."
        );
        return;
      }
      const dist = distanceMeters(pos.latitude, pos.longitude, lat as number, lng as number);
      if (dist > PROXIMITY_M) {
        setError(
          `You need to be at ${venueName} to report — you're about ${formatDistance(dist)} away.`
        );
        return;
      }

      const supabase = createSupabaseBrowserClient();
      const { error: rpcError } = await supabase.rpc("report_court_availability", {
        p_court_id: courtId,
        p_has_empty: hasEmpty,
      });
      if (rpcError) {
        setError(rpcError.message || "Couldn't send your report.");
        return;
      }
      setDone(true);
      onReported?.();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(null);
    }
  }

  if (done) {
    return (
      <div
        className={`flex items-center gap-1.5 text-court-green ${
          variant === "detail" ? "text-sm py-1" : "text-xs"
        }`}
      >
        <span aria-hidden>✓</span>
        <span className="font-medium">Thanks! Report sent.</span>
      </div>
    );
  }

  const buttonBase =
    "flex-1 inline-flex items-center justify-center gap-1 rounded-lg font-medium disabled:opacity-50";
  const buttonSize = variant === "detail" ? "px-3 py-2 text-sm" : "px-2 py-1.5 text-xs";

  return (
    <div className="space-y-1.5">
      <p
        className={`text-gray-500 ${variant === "detail" ? "text-sm" : "text-[11px]"}`}
      >
        Are courts open right now?
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => submit(true)}
          disabled={submitting !== null}
          className={`${buttonBase} ${buttonSize} bg-court-green hover:bg-court-green-light text-white`}
        >
          {submitting === "yes" ? "Sending…" : "Open courts"}
        </button>
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={submitting !== null}
          className={`${buttonBase} ${buttonSize} bg-gray-100 hover:bg-gray-200 text-gray-700`}
        >
          {submitting === "no" ? "Sending…" : "All full"}
        </button>
      </div>
      {error && (
        <p
          className={`text-red-600 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5 ${
            variant === "detail" ? "text-xs" : "text-[11px]"
          }`}
        >
          {error}
        </p>
      )}
    </div>
  );
}
