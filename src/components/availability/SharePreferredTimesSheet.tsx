"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

// "use client" guarantees this renders only after hydration, so document is
// always defined. No SSR-mount flag needed.
import type { RankedWindow } from "@/lib/availabilityPoll";
import { buildPollShare } from "@/lib/availabilityPollShare";
import { nativeShare } from "@/lib/lfpShare";

interface Props {
  teamName: string;
  topWindows: RankedWindow[];
  nearMissWindows: RankedWindow[];
  onClose: () => void;
}

function windowKey(w: RankedWindow): string {
  return `${w.date}|${w.start}`;
}

function formatDateLong(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// Modal/sheet rendered via portal — mirrors the popover pattern in the
// matches availability page. Captain ticks which ranked windows to include
// and shares via the native iOS share sheet (Capacitor) with a Web Share /
// clipboard fallback for desktop.
export function SharePreferredTimesSheet({
  teamName,
  topWindows,
  nearMissWindows,
  onClose,
}: Props) {
  // Default: top windows pre-checked, near-miss windows unchecked.
  const [selected, setSelected] = useState<Set<string>>(() => {
    return new Set(topWindows.map(windowKey));
  });

  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // ESC dismisses; lock body scroll while open. Matches the existing Modal /
  // popover handling on the team pages.
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

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const orderedSelected = useMemo<RankedWindow[]>(() => {
    // Preserve the ranking order: top windows first, then near-miss windows.
    const all = [...topWindows, ...nearMissWindows];
    return all.filter((w) => selected.has(windowKey(w)));
  }, [selected, topWindows, nearMissWindows]);

  const onShare = async () => {
    if (sharing || orderedSelected.length === 0) return;
    setSharing(true);
    setError(null);
    setStatusMsg(null);
    const payload = buildPollShare({
      teamName,
      windows: orderedSelected,
    });
    const result = await nativeShare(payload, "pollShare");
    setSharing(false);
    if (result.outcome === "shared") {
      onClose();
    } else if (result.outcome === "copied") {
      setStatusMsg("Copied to clipboard");
      setTimeout(() => onClose(), 1200);
    } else if (result.outcome === "cancelled") {
      // Stay open silently.
    } else {
      setError(result.error || "Could not share. Try again.");
    }
  };

  const hasAny = topWindows.length + nearMissWindows.length > 0;

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative w-full max-w-md bg-white rounded-xl shadow-xl">
          <div className="flex items-start justify-between p-4 border-b">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Share preferred times</h2>
              <p className="text-xs text-gray-500 mt-0.5">{teamName}</p>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-4 max-h-[60vh] overflow-y-auto">
            {!hasAny && (
              <p className="text-sm text-gray-400 py-2">
                No ranked windows yet — wait for more members to respond.
              </p>
            )}

            {topWindows.length > 0 && (
              <ul className="space-y-1.5">
                {topWindows.map((w) => {
                  const key = windowKey(w);
                  const checked = selected.has(key);
                  return (
                    <li key={key}>
                      <label className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(key)}
                          className="w-4 h-4 accent-court-green"
                        />
                        <span className="text-sm text-gray-900">
                          {formatDateLong(w.date)} · {w.start}–{w.end}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}

            {nearMissWindows.length > 0 && (
              <>
                <h3 className="text-xs uppercase tracking-wider font-bold text-gray-400 mt-4 mb-1 px-2">
                  One player short
                </h3>
                <ul className="space-y-1.5">
                  {nearMissWindows.map((w) => {
                    const key = windowKey(w);
                    const checked = selected.has(key);
                    return (
                      <li key={key}>
                        <label className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(key)}
                            className="w-4 h-4 accent-court-green"
                          />
                          <span className="text-sm text-gray-500">
                            {formatDateLong(w.date)} · {w.start}–{w.end}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
            {statusMsg && <p className="text-sm text-court-green mt-3">{statusMsg}</p>}
          </div>

          <div className="flex gap-2 p-4 border-t">
            <button
              onClick={onShare}
              disabled={sharing || orderedSelected.length === 0}
              className="btn-primary flex-1"
            >
              {sharing ? "Sharing…" : "Share"}
            </button>
            <button onClick={onClose} className="btn-secondary flex-1">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
