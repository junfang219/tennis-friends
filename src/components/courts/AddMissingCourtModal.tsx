"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentPosition, isPositionError } from "@/lib/getCurrentPosition";

type Props = {
  /** Current user geolocation (from CourtsPage). Null = location unavailable. */
  myLocation: { lat: number; lng: number } | null;
  onClose: () => void;
};

type LocationMode = "current" | "address";

const MIN_NAME = 2;
const MAX_NAME = 200;
const MAX_NOTES = 2000;
const MAX_ADDRESS = 300;

export function AddMissingCourtModal({ myLocation, onClose }: Props) {
  const [name, setName] = useState("");
  const [locationMode, setLocationMode] = useState<LocationMode>(
    myLocation ? "current" : "address"
  );
  // Snapshot the location at modal-open time so it doesn't shift mid-form.
  const [capturedLocation, setCapturedLocation] = useState(myLocation);
  const [address, setAddress] = useState("");
  const [courtCount, setCourtCount] = useState<string>("");
  const [indoorOutdoor, setIndoorOutdoor] = useState<string>("");
  const [managedBy, setManagedBy] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [reporterEmail, setReporterEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Leaflet's zoom control renders into its own stacking context, so even a
    // high-z-index backdrop can leave it visible on top of the modal. Hide it
    // outright while the modal is open and restore on close.
    const zoomControls = document.querySelectorAll<HTMLElement>(".leaflet-control-zoom");
    const prevDisplay: string[] = [];
    zoomControls.forEach((el) => {
      prevDisplay.push(el.style.display);
      el.style.display = "none";
    });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      zoomControls.forEach((el, i) => {
        el.style.display = prevDisplay[i] ?? "";
      });
    };
  }, [onClose]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(onClose, 1500);
    return () => clearTimeout(t);
  }, [done, onClose]);

  async function recapture() {
    const pos = await getCurrentPosition();
    if (isPositionError(pos)) {
      setErrorMessage("Couldn't get your location. Try entering an address instead.");
      return;
    }
    setCapturedLocation({ lat: pos.latitude, lng: pos.longitude });
  }

  const trimmedName = name.trim();
  const trimmedAddress = address.trim();
  const locationValid =
    locationMode === "current"
      ? capturedLocation != null
      : trimmedAddress.length > 0;
  const canSubmit =
    !submitting &&
    !done &&
    trimmedName.length <= MAX_NAME &&
    locationValid;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMessage(null);
    const payload: Record<string, unknown> = {};
    if (trimmedName.length >= MIN_NAME) payload.courtName = trimmedName;
    if (locationMode === "current" && capturedLocation) {
      payload.latitude = capturedLocation.lat;
      payload.longitude = capturedLocation.lng;
    }
    if (locationMode === "address" && trimmedAddress) {
      payload.address = trimmedAddress;
    }
    const countNum = courtCount.trim() ? parseInt(courtCount, 10) : NaN;
    if (Number.isFinite(countNum)) payload.courtCount = countNum;
    if (indoorOutdoor) payload.indoorOutdoor = indoorOutdoor;
    if (managedBy) payload.managedBy = managedBy;
    if (notes.trim()) payload.notes = notes.trim();
    if (reporterEmail.trim()) payload.reporterEmail = reporterEmail.trim();

    try {
      const res = await fetch("/api/report-missing-court", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      const body = await res.json().catch(() => ({}));
      const msg = body?.error;
      if (res.status === 503) {
        setErrorMessage(msg || "Reporting isn't set up yet.");
      } else if (res.status === 429) {
        setErrorMessage(msg || "Please wait before sending another report.");
      } else if (typeof msg === "string") {
        setErrorMessage(msg);
      } else {
        setErrorMessage(`Couldn't send (HTTP ${res.status}). Please try again.`);
      }
    } catch {
      setErrorMessage("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[10000] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md flex flex-col overflow-hidden
                   max-h-[calc(100dvh-4rem-env(safe-area-inset-bottom))] sm:max-h-[92vh]
                   mb-[calc(4rem+env(safe-area-inset-bottom))] sm:mb-0"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-missing-court-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <h3 id="add-missing-court-title" className="font-semibold text-gray-900 text-sm">
            Report a missing court
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center flex-shrink-0"
            aria-label="Close report dialog"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 overflow-y-auto flex-1 min-h-0">
          {done ? (
            <div className="py-6 text-center">
              <div className="text-2xl mb-1">✓</div>
              <p className="text-sm font-semibold text-court-green">Thanks! Your suggestion was sent.</p>
              <p className="text-[11px] text-gray-500 mt-1">Closing…</p>
            </div>
          ) : (
            <>
              {/* Court name */}
              <label className="block">
                <span className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Court name <span className="text-gray-400 normal-case tracking-normal">(if you know it)</span>
                </span>
                <input
                  ref={nameRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, MAX_NAME))}
                  placeholder="e.g. Magnuson Park West Courts — or leave blank and describe it in Notes"
                  disabled={submitting}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:border-court-green focus:outline-none focus:ring-2 focus:ring-court-green/20 disabled:bg-gray-50"
                />
              </label>

              {/* Location source */}
              <fieldset className="mt-3">
                <legend className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Location <span className="text-red-500">*</span>
                </legend>
                <div className="space-y-2">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="location-mode"
                      value="current"
                      checked={locationMode === "current"}
                      onChange={() => setLocationMode("current")}
                      disabled={submitting || !capturedLocation}
                      className="mt-1"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-gray-800">
                        📍 Use my current location
                      </span>
                      {capturedLocation ? (
                        <span className="block text-[11px] text-gray-500 mt-0.5">
                          Captured: {capturedLocation.lat.toFixed(6)}, {capturedLocation.lng.toFixed(6)}{" "}
                          <button
                            type="button"
                            onClick={recapture}
                            className="text-court-green hover:underline ml-1"
                          >
                            Re-capture
                          </button>
                        </span>
                      ) : (
                        <span className="block text-[11px] text-gray-400 mt-0.5">
                          (location not available — try address below)
                        </span>
                      )}
                    </span>
                  </label>

                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="location-mode"
                      value="address"
                      checked={locationMode === "address"}
                      onChange={() => setLocationMode("address")}
                      disabled={submitting}
                      className="mt-1"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-gray-800 mb-1">
                        🏷️ Enter address
                      </span>
                      <input
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value.slice(0, MAX_ADDRESS))}
                        onFocus={() => setLocationMode("address")}
                        placeholder="e.g. 7400 Sand Point Way NE, Seattle, WA"
                        disabled={submitting || locationMode !== "address"}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:border-court-green focus:outline-none focus:ring-2 focus:ring-court-green/20 disabled:bg-gray-50"
                      />
                    </span>
                  </label>
                </div>
              </fieldset>

              {/* Optional details */}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Court count
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={courtCount}
                    onChange={(e) => setCourtCount(e.target.value)}
                    placeholder="e.g. 4"
                    disabled={submitting}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:border-court-green focus:outline-none focus:ring-2 focus:ring-court-green/20 disabled:bg-gray-50"
                  />
                </label>
                <label className="block">
                  <span className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Indoor / Outdoor
                  </span>
                  <select
                    value={indoorOutdoor}
                    onChange={(e) => setIndoorOutdoor(e.target.value)}
                    disabled={submitting}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:border-court-green focus:outline-none focus:ring-2 focus:ring-court-green/20 disabled:bg-gray-50"
                  >
                    <option value="">—</option>
                    <option value="outdoor">Outdoor</option>
                    <option value="indoor">Indoor</option>
                    <option value="both">Both</option>
                  </select>
                </label>
              </div>

              <label className="block mt-3">
                <span className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Managed by
                </span>
                <select
                  value={managedBy}
                  onChange={(e) => setManagedBy(e.target.value)}
                  disabled={submitting}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:border-court-green focus:outline-none focus:ring-2 focus:ring-court-green/20 disabled:bg-gray-50"
                >
                  <option value="">—</option>
                  <option value="city">City or park</option>
                  <option value="club">Club</option>
                  <option value="school">School</option>
                  <option value="other">Other</option>
                </select>
              </label>

              {/* Notes */}
              <label className="block mt-3">
                <span className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Notes
                </span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value.slice(0, MAX_NOTES))}
                  placeholder="Anything else useful — lighting, surface, public-access hours, etc."
                  rows={3}
                  disabled={submitting}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:border-court-green focus:outline-none focus:ring-2 focus:ring-court-green/20 disabled:bg-gray-50 resize-y min-h-[4rem]"
                />
                <p className="text-[10px] text-gray-400 mt-1 text-right">
                  {notes.length} / {MAX_NOTES}
                </p>
              </label>

              {/* Reporter email */}
              <label className="block mt-3">
                <span className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Your email (optional)
                </span>
                <input
                  type="email"
                  value={reporterEmail}
                  onChange={(e) => setReporterEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={submitting}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:border-court-green focus:outline-none focus:ring-2 focus:ring-court-green/20 disabled:bg-gray-50"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  Leave blank to report anonymously. If you include it, the developer can reply.
                </p>
              </label>

              {/* Error */}
              {errorMessage && (
                <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {errorMessage}
                </p>
              )}

              {/* Buttons */}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-medium text-gray-700 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmit}
                  className="px-3 py-2 rounded-lg bg-court-green hover:bg-court-green-light text-sm font-semibold text-white disabled:opacity-50"
                >
                  {submitting ? "Sending…" : "Submit"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
