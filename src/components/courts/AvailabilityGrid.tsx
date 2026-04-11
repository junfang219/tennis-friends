"use client";

import { useState, useEffect, useCallback } from "react";

interface TimeSlot {
  courtName: string;
  startTime: string;
  endTime: string;
  available: boolean;
  bookingUrl: string;
}

interface AvailabilityData {
  venueId: string;
  date: string;
  source: string;
  courts: Array<{ id: number; name: string; capacity: number }>;
  slots: TimeSlot[];
  note?: string;
}

interface AvailabilityGridProps {
  venueId: string;
  venueName: string;
  date: string;
  onBook?: (slot: TimeSlot) => void;
}

function formatTime(t: string): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

export default function AvailabilityGrid({
  venueId,
  venueName,
  date,
  onBook,
}: AvailabilityGridProps) {
  const [data, setData] = useState<AvailabilityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchAvailability = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const url = `/api/courts/availability?venueId=${encodeURIComponent(venueId)}&date=${encodeURIComponent(date)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load availability");
      const json = await res.json();
      setData(json);
    } catch {
      setError("Couldn't load availability. Try again.");
    } finally {
      setLoading(false);
    }
  }, [venueId, date]);

  useEffect(() => {
    fetchAvailability();
  }, [fetchAvailability]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <div className="flex items-center gap-3">
          <svg
            className="animate-spin w-5 h-5 text-court-green"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="3"
              opacity="0.3"
            />
            <path
              d="M12 2a10 10 0 019.95 9"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
          <span className="text-sm text-gray-500">
            Checking availability at {venueName}...
          </span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl border border-red-100 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-red-600">{error}</p>
          <button
            onClick={fetchAvailability}
            className="text-xs font-semibold text-red-700 bg-red-50 px-3 py-1.5 rounded-lg hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data || data.slots.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6 text-center">
        <p className="text-sm text-gray-500">
          No availability data for this date.
        </p>
      </div>
    );
  }

  // Group slots by court name
  const courtNames = [...new Set(data.slots.map((s) => s.courtName))];

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-court-green/5 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm text-gray-800">
              Availability
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {courtNames.length} court{courtNames.length !== 1 ? "s" : ""} on{" "}
              {new Date(date + "T12:00:00").toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </p>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">
            Estimated
          </span>
        </div>
      </div>

      {/* Grid */}
      <div className="p-4 space-y-4">
        {courtNames.map((courtName) => {
          const courtSlots = data.slots.filter(
            (s) => s.courtName === courtName
          );
          return (
            <div key={courtName}>
              {courtNames.length > 1 && (
                <p className="text-xs font-semibold text-gray-600 mb-2">
                  {courtName}
                </p>
              )}
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-1.5">
                {courtSlots.map((slot) => (
                  <button
                    key={`${slot.courtName}-${slot.startTime}`}
                    onClick={() => {
                      if (onBook) {
                        onBook(slot);
                      } else {
                        window.open(slot.bookingUrl, "_blank", "noopener");
                      }
                    }}
                    className={`
                      px-2 py-2 rounded-lg text-xs font-medium text-center transition-all
                      ${
                        slot.available
                          ? "bg-court-green/10 text-court-green hover:bg-court-green/20 hover:shadow-sm cursor-pointer"
                          : "bg-gray-100 text-gray-400 cursor-not-allowed"
                      }
                    `}
                    disabled={!slot.available}
                    title={
                      slot.available
                        ? `Book ${formatTime(slot.startTime)} - ${formatTime(slot.endTime)}`
                        : "Unavailable"
                    }
                  >
                    {formatTime(slot.startTime)}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer note */}
      {data.note && (
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
          <p className="text-[11px] text-gray-400">{data.note}</p>
        </div>
      )}

      {/* Legend */}
      <div className="px-4 py-2 border-t border-gray-100 flex items-center gap-4 text-[11px] text-gray-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-court-green/10 border border-court-green/20" />
          Available
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-gray-100 border border-gray-200" />
          Booked
        </span>
      </div>
    </div>
  );
}
