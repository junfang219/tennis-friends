"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import AvailabilityGrid from "@/components/courts/AvailabilityGrid";
import PrivacyNotice from "@/components/courts/PrivacyNotice";

interface CourtDetail {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  courts: number;
  surface: string;
  lit: boolean;
  activeNet: {
    phone: string;
    description: string;
    minTime: number;
    maxTime: number;
    maxCapacity: number;
    openingHours: Array<{
      dateRange: string;
      daysOfWeek: string;
      openingTimes: string;
    }>;
    amenities: string[];
    restrictions: string[];
  } | null;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Quick date buttons (today, tomorrow, next 5 days)
function getDateOptions(): Array<{ label: string; value: string }> {
  const options: Array<{ label: string; value: string }> = [];
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const value = d.toISOString().slice(0, 10);
    const label =
      i === 0 ? "Today" : i === 1 ? "Tomorrow" : days[d.getDay()];
    options.push({ label, value });
  }
  return options;
}

const BOOKING_BASE =
  "https://anc.apm.activecommunities.com/seattle/reservation/search";

export default function CourtDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const [court, setCourt] = useState<CourtDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState(todayStr());

  const popupRef = useRef<Window | null>(null);
  const openSeattleParksPopup = useCallback((url: string) => {
    if (typeof window === "undefined") return;
    if (popupRef.current && !popupRef.current.closed) {
      try {
        popupRef.current.location.href = url;
        popupRef.current.focus();
        return;
      } catch {
        // cross-origin fallback
      }
    }
    const width = 720;
    const height = Math.min(900, window.screen?.availHeight || 900);
    const left = Math.max(0, (window.screen?.availWidth || 1400) - width);
    const features = `width=${width},height=${height},left=${left},top=0,resizable=yes,scrollbars=yes`;
    popupRef.current = window.open(url, "seattleParks", features);
  }, []);

  const dateOptions = getDateOptions();

  const fetchCourt = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/courts/${encodeURIComponent(id)}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error("Court not found");
        throw new Error("Failed to load court details");
      }
      const data = await res.json();
      setCourt(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchCourt();
  }, [fetchCourt]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-20 bg-gray-200 rounded" />
          <div className="h-8 w-64 bg-gray-200 rounded" />
          <div className="h-4 w-48 bg-gray-200 rounded" />
          <div className="h-64 bg-gray-100 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !court) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Link
          href="/courts"
          className="text-sm text-court-green hover:underline mb-4 inline-block"
        >
          &larr; Back to Courts
        </Link>
        <div className="bg-red-50 rounded-xl border border-red-200 p-6 text-center">
          <p className="text-red-600 font-medium">{error || "Court not found"}</p>
          <button
            onClick={fetchCourt}
            className="mt-3 text-sm font-semibold text-red-700 bg-red-100 px-4 py-2 rounded-lg hover:bg-red-200"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const bookingUrl = `${BOOKING_BASE}?keyword=${encodeURIComponent(court.name)}&resourceType=0&equipmentQty=0`;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Breadcrumb */}
      <Link
        href="/courts"
        className="text-sm text-court-green hover:underline mb-4 inline-flex items-center gap-1"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
        All Courts
      </Link>

      {/* Header */}
      <div className="mt-3 mb-6">
        <h1 className="font-display text-2xl font-bold text-court-green">
          {court.name}
        </h1>
        <p className="text-gray-500 text-sm mt-1">{court.address}</p>

        {/* Quick stats */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-court-green/10 text-court-green text-sm font-medium">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
            {court.courts} court{court.courts !== 1 ? "s" : ""}
          </span>

          <span className="inline-flex items-center px-3 py-1 rounded-full bg-gray-100 text-gray-700 text-sm font-medium capitalize">
            {court.surface} surface
          </span>

          {court.lit && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-ball-yellow/20 text-amber-700 text-sm font-medium">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 2v3m0 14v3M4.93 4.93l2.12 2.12m9.9 9.9l2.12 2.12M2 12h3m14 0h3M4.93 19.07l2.12-2.12m9.9-9.9l2.12-2.12M12 8a4 4 0 100 8 4 4 0 000-8z" />
              </svg>
              Lighted
            </span>
          )}
        </div>
      </div>

      {/* ActiveNet details */}
      {court.activeNet && (
        <div className="mb-6 bg-white rounded-xl border border-gray-100 overflow-hidden">
          {court.activeNet.description && (
            <div className="px-4 py-3 border-b border-gray-50">
              <p className="text-sm text-gray-600">
                {court.activeNet.description}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-gray-100">
            {court.activeNet.phone && (
              <div className="bg-white px-4 py-3">
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">
                  Phone
                </p>
                <p className="text-sm text-gray-800 mt-0.5">
                  {court.activeNet.phone}
                </p>
              </div>
            )}
            <div className="bg-white px-4 py-3">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">
                Min Booking
              </p>
              <p className="text-sm text-gray-800 mt-0.5">
                {court.activeNet.minTime} min
              </p>
            </div>
            <div className="bg-white px-4 py-3">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">
                Max Booking
              </p>
              <p className="text-sm text-gray-800 mt-0.5">
                {court.activeNet.maxTime} min
              </p>
            </div>
          </div>

          {court.activeNet.openingHours.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-100">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">
                Hours
              </p>
              <div className="space-y-1">
                {court.activeNet.openingHours.map((h, i) => (
                  <div key={i} className="text-sm text-gray-700 flex gap-2">
                    <span className="text-gray-500 min-w-[100px]">
                      {h.daysOfWeek}
                    </span>
                    <span>{h.openingTimes}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {court.activeNet.amenities.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-100">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">
                Amenities
              </p>
              <div className="flex flex-wrap gap-1.5">
                {court.activeNet.amenities.map((a) => (
                  <span
                    key={a}
                    className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[11px] font-medium"
                  >
                    {a}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Date picker */}
      <div className="mb-4">
        <h2 className="font-semibold text-sm text-gray-800 mb-2">
          Check Availability
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {dateOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSelectedDate(opt.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                selectedDate === opt.value
                  ? "bg-court-green text-white shadow-sm"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {opt.label}
            </button>
          ))}
          <input
            type="date"
            value={selectedDate}
            min={todayStr()}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-xs border border-gray-200 focus:outline-none focus:border-court-green"
          />
        </div>
      </div>

      {/* Availability grid */}
      <div className="mb-6">
        <AvailabilityGrid
          venueId={court.id}
          venueName={court.name}
          date={selectedDate}
        />
      </div>

      {/* Book button — opens Seattle Parks in a side popup */}
      <div className="mb-6">
        <button
          onClick={() => openSeattleParksPopup(bookingUrl)}
          className="btn-primary w-full flex items-center justify-center gap-2 py-3"
        >
          Book on Seattle Parks
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </button>
      </div>

      {/* Directions */}
      <div className="mb-6">
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${court.lat},${court.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-court-green transition-colors"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          Get Directions
        </a>
      </div>

      {/* Privacy */}
      <PrivacyNotice />
    </div>
  );
}
