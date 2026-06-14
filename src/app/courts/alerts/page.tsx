"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/supabase/nextauth-compat";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  listMyCourtAlerts,
  setCourtAlertActive,
  deleteCourtAlert,
  type CourtAlert,
} from "@/lib/supabase/queries";
import { getFacilityByCourtId } from "@/lib/facilities";
import { useCachedQuery } from "@/lib/useCachedQuery";
import { errorMessage } from "@/lib/errorMessage";

const ALERTS_CACHE_KEY = "courtAlerts:mine";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function venueName(courtId: string): string {
  return getFacilityByCourtId(courtId)?.name ?? "A court";
}

function dateLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function whenLabel(a: CourtAlert): string {
  if (a.mode === "once") return a.target_date ? dateLabel(a.target_date) : "—";
  const days = (a.weekdays ?? []).slice().sort().map((w) => WEEKDAY_LABELS[w]);
  return days.length === 7 ? "Every day" : `Every ${days.join(", ")}`;
}

function hm(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ap = h < 12 ? "am" : "pm";
  return m === 0 ? `${h12}${ap}` : `${h12}:${String(m).padStart(2, "0")}${ap}`;
}

function timeLabel(a: CourtAlert): string {
  if (!a.start_time && !a.end_time) return "Any time";
  if (a.start_time && a.end_time) return `${hm(a.start_time)}–${hm(a.end_time)}`;
  return a.start_time ? `From ${hm(a.start_time)}` : `Until ${hm(a.end_time!)}`;
}

function channelLabel(a: CourtAlert): string {
  const parts: string[] = [];
  if (a.notify_push) parts.push("Push");
  if (a.notify_email) parts.push("Email");
  return parts.join(" · ");
}

export default function CourtAlertsPage() {
  const { status } = useSession();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const query = useCachedQuery(
    status === "authenticated" ? ALERTS_CACHE_KEY : null,
    () => listMyCourtAlerts(createSupabaseBrowserClient())
  );
  const alerts = query.data;

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  const toggle = async (a: CourtAlert) => {
    setError("");
    setBusyId(a.id);
    try {
      await setCourtAlertActive(createSupabaseBrowserClient(), a.id, !a.active);
      await query.refetch();
    } catch (err) {
      setError(errorMessage(err, "Couldn't update the alert."));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (a: CourtAlert) => {
    setError("");
    setBusyId(a.id);
    query.mutate((prev) => (prev ?? []).filter((x) => x.id !== a.id));
    try {
      await deleteCourtAlert(createSupabaseBrowserClient(), a.id);
      await query.refetch();
    } catch (err) {
      setError(errorMessage(err, "Couldn't delete the alert."));
      await query.refetch();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/courts" aria-label="Back to courts" className="btn-secondary btn-sm">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <h1 className="font-display text-2xl font-bold text-court-green">Court alerts</h1>
      </div>

      <p className="text-sm text-gray-500 mb-4">
        We&apos;ll notify you when a court opens up at a venue you&apos;re watching. Add
        an alert from any court&apos;s page.
      </p>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {alerts === undefined ? (
        <div className="space-y-3">
          <div className="skeleton w-full h-20 rounded-2xl" />
          <div className="skeleton w-full h-20 rounded-2xl" />
        </div>
      ) : alerts.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-8 text-center">
          <div className="text-3xl mb-2">🔔</div>
          <p className="text-sm font-semibold text-gray-900">No alerts yet</p>
          <p className="text-sm text-gray-500 mt-1">
            Open a court and tap{" "}
            <span className="font-medium text-court-green">Alert me when open</span>.
          </p>
          <Link
            href="/courts"
            className="inline-block mt-4 px-4 py-2 rounded-lg bg-court-green text-white text-sm font-semibold hover:bg-court-green-light"
          >
            Browse courts
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {alerts.map((a) => (
            <li
              key={a.id}
              className={`bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-4 ${
                a.active ? "" : "opacity-60"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <Link href={`/courts/${encodeURIComponent(a.court_id)}`} className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate hover:text-court-green">
                    {venueName(a.court_id)}
                  </p>
                  <p className="text-sm text-gray-600 mt-0.5">
                    {whenLabel(a)} · {timeLabel(a)}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-1">
                    {channelLabel(a)}
                    {!a.active && " · paused"}
                  </p>
                </Link>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggle(a)}
                    disabled={busyId === a.id}
                    className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-xs font-semibold hover:bg-gray-200 disabled:opacity-50"
                  >
                    {a.active ? "Pause" : "Resume"}
                  </button>
                  <button
                    onClick={() => remove(a)}
                    disabled={busyId === a.id}
                    aria-label="Delete alert"
                    className="w-8 h-8 rounded-lg bg-gray-100 text-gray-500 hover:bg-red-500 hover:text-white flex items-center justify-center disabled:opacity-50"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
