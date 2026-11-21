"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { buildResourceBookingUrl } from "@/lib/activenet";
import type { CourtBooking } from "@/lib/supabase/queries/bookings";
import { useSupabaseUser } from "@/lib/supabase/useUser";
import { errorMessage } from "@/lib/errorMessage";

export interface BookingSheetProps {
  resourceId: number;
  centerId: number;
  courtName: string;
  venueName: string;
  facilityId: string | null;
  date: string; // 'YYYY-MM-DD'
  startTime: string; // 'HH:mm'
  endTime: string; // 'HH:mm'
  slotBookingUrl: string;
  onClose: () => void;
  onBooked?: (booking: CourtBooking) => void;
}

/** "AYTC Outdoor Tennis Court 01" → "Court 01"; otherwise the full name. */
function shortCourtName(name: string): string {
  const cleaned = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const m = cleaned.match(/(court\s+\S+)\s*$/i);
  return m ? m[1].replace(/^c/, "C") : cleaned;
}

function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const suffix = h < 12 ? "am" : "pm";
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

// Half-hour options from 6:00 to 23:00 for the confirmation form.
const TIME_OPTIONS = Array.from({ length: (23 - 6) * 2 + 1 }, (_, i) => {
  const min = 6 * 60 + i * 30;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});

export default function BookingSheet({
  resourceId,
  centerId,
  courtName,
  venueName,
  facilityId,
  date,
  startTime,
  endTime,
  slotBookingUrl,
  onClose,
  onBooked,
}: BookingSheetProps) {
  const { user } = useSupabaseUser();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [confirming, setConfirming] = useState(false);
  // startTime/endTime are the exact range the user selected on the grid.
  // Editable in the confirm panel — the user may have booked a different
  // window than the one they selected.
  const [confirmStart, setConfirmStart] = useState(startTime);
  const [confirmEnd, setConfirmEnd] = useState(endTime);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<CourtBooking | null>(null);
  const bookingUrl = buildResourceBookingUrl(resourceId);
  const timeOptions = [...new Set([...TIME_OPTIONS, startTime, endTime])].sort();

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  function close() {
    dialogRef.current?.close();
    onClose();
  }

  const save = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceId,
          centerId,
          facilityId,
          courtName,
          venueName,
          date,
          startTime: confirmStart,
          endTime: confirmEnd,
          confirmation: "manual",
          activenetUrl: bookingUrl,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Couldn't save booking.");
      setSaved(body.booking as CourtBooking);
      onBooked?.(body.booking as CourtBooking);
    } catch (err) {
      setSaveError(errorMessage(err, "Couldn't save booking."));
    } finally {
      setSaving(false);
    }
  }, [
    resourceId,
    centerId,
    facilityId,
    courtName,
    venueName,
    date,
    confirmStart,
    confirmEnd,
    bookingUrl,
    onBooked,
  ]);

  const slotLabel = `${fmtDate(date)} · ${to12h(startTime)}–${to12h(endTime)}`;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="booking-sheet-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[calc(100dvh-1rem)] max-w-none w-full overflow-y-auto rounded-t-2xl bg-white text-gray-900 backdrop:bg-black/60 sm:inset-0 sm:m-auto sm:max-w-md sm:rounded-2xl"
    >
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 id="booking-sheet-title" className="text-sm font-semibold">
            Book {shortCourtName(courtName)}
          </h3>
          <p className="text-xs text-gray-600">{slotLabel}</p>
        </div>
        <button
          type="button"
          onClick={close}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-gray-100"
          aria-label="Close booking"
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {!confirming ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Choose the matching court on Seattle Parks to continue with your
              selected time. After checkout, return here to save your booking.
            </p>
            <a
              href={slotBookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary flex w-full items-center justify-center py-2.5 text-sm"
            >
              Open Seattle Parks<span className="sr-only"> (opens in a new tab)</span>
            </a>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-court-green hover:bg-gray-50"
            >
              I completed my booking
            </button>
          </div>
        ) : saved ? (
          <div className="max-w-sm mx-auto text-center py-8">
            <div className="text-3xl mb-2">🎾</div>
            <h4 className="font-semibold text-gray-900">Booking saved</h4>
            <p className="mt-1 text-sm text-gray-500">
              {venueName} · {shortCourtName(courtName)}
              <br />
              {fmtDate(date)}, {to12h(confirmStart)}–{to12h(confirmEnd)}
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <Link
                href="/bookings"
                className="w-full inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-court-green text-white font-semibold text-sm"
              >
                View my bookings
              </Link>
              <button
                onClick={close}
                className="w-full inline-flex items-center justify-center px-4 py-2.5 rounded-lg border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="max-w-sm mx-auto">
            <h4 className="font-semibold text-gray-900">
              Save this booking?
            </h4>
            <p className="mt-1 text-sm text-gray-500">
              Confirm the court and time you booked on Seattle Parks so it
              shows up in your bookings.
            </p>

            <div className="mt-4 rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
              <div className="flex justify-between px-3 py-2">
                <span className="text-gray-500">Venue</span>
                <span className="font-medium text-gray-900 text-right">
                  {venueName}
                </span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="text-gray-500">Court</span>
                <span className="font-medium text-gray-900 text-right">
                  {shortCourtName(courtName)}
                </span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="text-gray-500">Date</span>
                <span className="font-medium text-gray-900">
                  {fmtDate(date)}
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2 gap-2">
                <span className="text-gray-500">Time</span>
                <span className="flex items-center gap-1">
                  <select
                    aria-label="Booking start time"
                    value={confirmStart}
                    onChange={(e) => setConfirmStart(e.target.value)}
                    className="rounded-md border border-gray-200 px-2 py-1 text-sm"
                  >
                    {timeOptions.map((t) => (
                      <option key={t} value={t}>
                        {to12h(t)}
                      </option>
                    ))}
                  </select>
                  <span className="text-gray-400">–</span>
                  <select
                    aria-label="Booking end time"
                    value={confirmEnd}
                    onChange={(e) => setConfirmEnd(e.target.value)}
                    className="rounded-md border border-gray-200 px-2 py-1 text-sm"
                  >
                    {timeOptions.map((t) => (
                      <option key={t} value={t}>
                        {to12h(t)}
                      </option>
                    ))}
                  </select>
                </span>
              </div>
            </div>

            {!user && (
              <p className="mt-3 text-xs text-amber-700">
                <Link href="/login" className="font-semibold underline">
                  Sign in to TennisFriend
                </Link>{" "}
                to save this booking.
              </p>
            )}
            {saveError && (
              <p role="alert" className="mt-3 text-sm text-red-600">{saveError}</p>
            )}

            <div className="mt-5 flex flex-col gap-2">
              <button
                onClick={save}
                disabled={saving || !user}
                className="w-full inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-court-green text-white font-semibold text-sm disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save to my bookings"}
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="w-full inline-flex items-center justify-center px-4 py-2.5 rounded-lg border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50"
              >
                Back to booking
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
