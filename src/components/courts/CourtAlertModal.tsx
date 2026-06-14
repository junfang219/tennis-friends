"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { createCourtAlert } from "@/lib/supabase/queries";
import {
  type Preset,
  PRESET_LABELS,
  HOUR_OPTIONS,
  presetRange,
} from "@/lib/courtTimePresets";
import { errorMessage } from "@/lib/errorMessage";

type Props = {
  courtId: string; // catalog "tf-N"
  courtName: string;
  onClose: () => void;
};

type Mode = "once" | "repeat";

const WEEKDAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** The 14 bookable dates: tomorrow through +14 (today is not online-bookable). */
function bookableDays(): { value: string; weekday: string; md: string }[] {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + 1 + i);
    return {
      value: ymd(d),
      weekday: d.toLocaleDateString([], { weekday: "short" }),
      md: d.toLocaleDateString([], { month: "numeric", day: "numeric" }),
    };
  });
}

export function CourtAlertModal({ courtId, courtName, onClose }: Props) {
  const [days] = useState(bookableDays);
  const [mode, setMode] = useState<Mode>("once");
  const [date, setDate] = useState(() => days[0]?.value ?? "");
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set());
  const [preset, setPreset] = useState<Preset>("any");
  const [customStart, setCustomStart] = useState("17:00");
  const [customEnd, setCustomEnd] = useState("20:00");
  const [notifyPush, setNotifyPush] = useState(true);
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const toggleWeekday = (v: number) =>
    setWeekdays((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });

  const validWhen = mode === "once" ? !!date : weekdays.size > 0;
  const validChannel = notifyPush || notifyEmail;
  const canSubmit = !submitting && !done && validWhen && validChannel;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const [start, end] = presetRange(preset, customStart, customEnd);
    try {
      const supabase = createSupabaseBrowserClient();
      await createCourtAlert(supabase, {
        courtId,
        mode,
        targetDate: mode === "once" ? date : null,
        weekdays: mode === "repeat" ? [...weekdays].sort() : null,
        startTime: start,
        endTime: end,
        notifyPush,
        notifyEmail,
      });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err, "Couldn't create the alert."));
    } finally {
      setSubmitting(false);
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[600] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="court-alert-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <div className="min-w-0">
            <h3 id="court-alert-title" className="font-semibold text-gray-900 text-sm">
              Alert me when open
            </h3>
            <p className="text-[11px] text-gray-500 truncate">{courtName}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center flex-shrink-0"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 overflow-y-auto">
          {done ? (
            <div className="py-6 text-center">
              <div className="text-2xl mb-1">🎾</div>
              <p className="text-sm font-semibold text-court-green">Alert set!</p>
              <p className="text-[12px] text-gray-500 mt-1 px-4">
                We&apos;ll notify you when a court opens up at {courtName}.
              </p>
              <div className="flex items-center justify-center gap-2 mt-4">
                <Link
                  href="/courts/alerts"
                  className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200"
                >
                  Manage alerts
                </Link>
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-court-green text-white text-sm font-semibold hover:bg-court-green-light"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* When */}
              <div className="flex gap-1.5 mb-3">
                {(["once", "repeat"] as Mode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      mode === m
                        ? "bg-court-green text-white"
                        : "bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100"
                    }`}
                  >
                    {m === "once" ? "A specific day" : "Repeat weekly"}
                  </button>
                ))}
              </div>

              {mode === "once" ? (
                <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
                  {days.map((d) => (
                    <button
                      key={d.value}
                      onClick={() => setDate(d.value)}
                      className={`flex flex-col items-center shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        d.value === date
                          ? "bg-court-green text-white"
                          : "bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200"
                      }`}
                    >
                      <span>{d.weekday}</span>
                      <span className={d.value === date ? "text-white/90" : "text-gray-400"}>
                        {d.md}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((w) => (
                    <button
                      key={w.value}
                      onClick={() => toggleWeekday(w.value)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                        weekdays.has(w.value)
                          ? "bg-court-green text-white"
                          : "bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200"
                      }`}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Time */}
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-4 mb-2">
                Time
              </p>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_LABELS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setPreset(p.key)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      preset === p.key
                        ? "bg-court-green text-white"
                        : "bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {preset === "custom" && (
                <div className="flex items-center gap-2 mt-3">
                  <HourSelect value={customStart} onChange={setCustomStart} />
                  <span className="text-gray-400 text-sm">to</span>
                  <HourSelect value={customEnd} onChange={setCustomEnd} />
                </div>
              )}

              {/* Channels */}
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-4 mb-2">
                Notify me via
              </p>
              <div className="space-y-2">
                <Toggle
                  label="Push notification"
                  checked={notifyPush}
                  onChange={setNotifyPush}
                />
                <Toggle label="Email" checked={notifyEmail} onChange={setNotifyEmail} />
              </div>
              <p className="text-[10px] text-gray-400 mt-2">
                Push reaches the iPhone app. Email works anywhere — pick it if you&apos;re
                not on iOS.
              </p>

              {error && (
                <p className="text-sm text-red-600 mt-3">{error}</p>
              )}
              {!validChannel && (
                <p className="text-[11px] text-amber-600 mt-2">
                  Pick at least one way to be notified.
                </p>
              )}

              <button
                onClick={submit}
                disabled={!canSubmit}
                className="mt-4 w-full rounded-lg bg-court-green text-white py-2.5 text-sm font-semibold hover:bg-court-green-light transition-colors disabled:opacity-50"
              >
                {submitting ? "Setting alert…" : "Set alert"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function HourSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-court-green/20"
    >
      {HOUR_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-gray-200 hover:bg-gray-50"
    >
      <span className="text-sm text-gray-700">{label}</span>
      <span
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked ? "bg-court-green" : "bg-gray-300"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}
