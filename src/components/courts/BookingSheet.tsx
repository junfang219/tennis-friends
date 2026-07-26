"use client";

// Full-screen sheet that embeds the Seattle Parks (ActiveNet) reservation
// page for one court through our same-origin /seattle proxy, so the user can
// sign in and complete checkout WITHOUT leaving the app. The proxy injects a
// bridge script (bookingBridgeScript.ts) that reports navigation + checkout
// completion back here; on completion — or via the manual "I completed my
// booking" fallback — we save the reservation to court_bookings.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { toProxyPath, buildResourceBookingUrl } from "@/lib/activenet";
import {
  isBridgeMessage,
  isCheckoutFunnelPath,
  type BridgeMessage,
} from "@/lib/bookingBridge";
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

// Half-hour options 6:00 .. 22:30 for the editable confirm-panel selects.
const TIME_OPTIONS = Array.from({ length: (23 - 6) * 2 + 1 }, (_, i) => {
  const min = 6 * 60 + i * 30;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});

type Stage = "browsing" | "confirming";

export default function BookingSheet({
  resourceId,
  centerId,
  courtName,
  venueName,
  facilityId,
  date,
  startTime,
  endTime,
  onClose,
  onBooked,
}: BookingSheetProps) {
  const { user } = useSupabaseUser();
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [stage, setStage] = useState<Stage>("browsing");
  // Whether the user got as far as the cart/checkout funnel — gates the
  // "did you complete the booking?" prompt on close.
  const reachedCheckout = useRef(false);
  const [detectedReceipt, setDetectedReceipt] = useState<string | null>(null);
  // startTime/endTime are the exact range the user selected on the grid.
  // Editable in the confirm panel — the user may have booked a different
  // window than the one they selected.
  const [confirmStart, setConfirmStart] = useState(startTime);
  const [confirmEnd, setConfirmEnd] = useState(endTime);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<CourtBooking | null>(null);
  // Whether the injected bridge managed to pre-select the slot in the
  // ActiveNet widget — flips the instruction chip copy.
  const [prefilled, setPrefilled] = useState(false);

  // Pass the selected slot to the proxied iframe as tf_* params; the injected
  // bridge script reads them and drives the reservation widget. ActiveNet
  // ignores unknown params, and the proxy forwards them verbatim.
  const proxyPath =
    `${toProxyPath(buildResourceBookingUrl(resourceId))}` +
    `&tf_date=${encodeURIComponent(date)}` +
    `&tf_start=${encodeURIComponent(startTime)}` +
    `&tf_end=${encodeURIComponent(endTime)}`;

  // Listen for bridge messages from the proxied iframe. Same-origin, so we
  // still hard-check the origin and message shape before trusting anything.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (!isBridgeMessage(e.data)) return;
      const msg = e.data as BridgeMessage;
      if (msg.type === "nav" && isCheckoutFunnelPath(msg.path)) {
        reachedCheckout.current = true;
      }
      if (msg.type === "prefill") {
        setPrefilled(msg.ok);
      }
      if (msg.type === "checkout-complete") {
        reachedCheckout.current = true;
        if (msg.receiptNumber) setDetectedReceipt(msg.receiptNumber);
        setStage("confirming");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

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
          confirmation: detectedReceipt ? "detected" : "manual",
          receiptNumber: detectedReceipt,
          activenetUrl: buildResourceBookingUrl(resourceId),
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
    detectedReceipt,
    onBooked,
  ]);

  // Closing: if they reached checkout but never confirmed a save, surface the
  // manual "did you complete the booking?" panel instead of closing silently.
  const requestClose = useCallback(() => {
    if (reachedCheckout.current && !saved && stage !== "confirming") {
      setStage("confirming");
      return;
    }
    onClose();
  }, [saved, stage, onClose]);

  const slotLabel = `${fmtDate(date)} · ${to12h(startTime)}–${to12h(endTime)}`;

  const sheet = (
    <div className="fixed inset-0 z-[650] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-3xl h-[92vh] sm:h-[88vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-gray-900 text-sm truncate">
              Book {shortCourtName(courtName)}
            </h3>
            <p className="text-[11px] text-gray-500 truncate">{slotLabel}</p>
          </div>
          {stage === "browsing" && (
            <button
              onClick={() => setStage("confirming")}
              className="shrink-0 text-xs font-semibold text-court-green hover:underline px-2 py-1"
            >
              I completed my booking
            </button>
          )}
          <button
            onClick={requestClose}
            className="shrink-0 w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Instruction chip — changes once the bridge pre-fills the slot. */}
        {stage === "browsing" && (
          <div className="px-4 py-2 bg-ball-yellow/15 border-b border-ball-yellow/30">
            <p className="text-[12px] text-amber-800 leading-snug">
              {prefilled ? (
                <>
                  We pre-selected{" "}
                  <strong>
                    {fmtDate(date)}, {to12h(startTime)}–{to12h(endTime)}
                  </strong>
                  . Review it, adjust if needed, then tap Check availability to
                  finish. Payment is handled by Seattle Parks.
                </>
              ) : (
                <>
                  Sign in with your Seattle Parks account and pick{" "}
                  <strong>
                    {fmtDate(date)}, {to12h(startTime)}–{to12h(endTime)}
                  </strong>
                  . Payment is handled by Seattle Parks.
                </>
              )}
            </p>
          </div>
        )}

        {/* Body: iframe (browsing) or confirm panel */}
        <div className="relative flex-1 overflow-hidden">
          {/* Keep the iframe mounted under the confirm panel so a stray close
              doesn't lose the session. */}
          <iframe
            src={proxyPath}
            title={`Reserve ${courtName} on Seattle Parks`}
            className="w-full h-full border-0"
            onLoad={() => setIframeLoaded(true)}
          />
          {!iframeLoaded && stage === "browsing" && (
            <div className="absolute inset-0 flex items-center justify-center bg-white">
              <div className="animate-pulse text-sm text-gray-400">
                Loading Seattle Parks…
              </div>
            </div>
          )}

          {stage === "confirming" && (
            <div className="absolute inset-0 bg-white overflow-y-auto p-5">
              {saved ? (
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
                      onClick={onClose}
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
                          value={confirmStart}
                          onChange={(e) => setConfirmStart(e.target.value)}
                          className="rounded-md border border-gray-200 px-2 py-1 text-sm"
                        >
                          {TIME_OPTIONS.map((t) => (
                            <option key={t} value={t}>
                              {to12h(t)}
                            </option>
                          ))}
                        </select>
                        <span className="text-gray-400">–</span>
                        <select
                          value={confirmEnd}
                          onChange={(e) => setConfirmEnd(e.target.value)}
                          className="rounded-md border border-gray-200 px-2 py-1 text-sm"
                        >
                          {TIME_OPTIONS.map((t) => (
                            <option key={t} value={t}>
                              {to12h(t)}
                            </option>
                          ))}
                        </select>
                      </span>
                    </div>
                    {detectedReceipt && (
                      <div className="flex justify-between px-3 py-2">
                        <span className="text-gray-500">Receipt</span>
                        <span className="font-medium text-gray-900">
                          {detectedReceipt}
                        </span>
                      </div>
                    )}
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
                    <p className="mt-3 text-sm text-red-600">{saveError}</p>
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
                      onClick={() =>
                        reachedCheckout.current ? onClose() : setStage("browsing")
                      }
                      className="w-full inline-flex items-center justify-center px-4 py-2.5 rounded-lg border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50"
                    >
                      {reachedCheckout.current ? "Not yet — close" : "Back to booking"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(sheet, document.body);
}
