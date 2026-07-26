"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/supabase/nextauth-compat";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  listMyBookings,
  markBookingCancelled,
  linkBookingSession,
  type CourtBooking,
} from "@/lib/supabase/queries";
import { useCachedQuery } from "@/lib/useCachedQuery";
import { errorMessage } from "@/lib/errorMessage";
import {
  ComposerModal,
  type ComposerInitialSession,
} from "@/components/PostComposer";

const BOOKINGS_CACHE_KEY = "courtBookings:mine";

/** "AYTC Outdoor Tennis Court 01" → "Court 01"; otherwise the full name. */
function shortCourtName(name: string): string {
  const cleaned = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const m = cleaned.match(/(court\s+\S+)\s*$/i);
  return m ? m[1].replace(/^c/, "C") : cleaned;
}

/** Wall-clock parts of a booking in its own timezone. */
function bookingParts(b: CourtBooking): {
  playDate: string;
  playTime: string;
  durationMin: number;
} {
  const start = new Date(b.start_time);
  const end = new Date(b.end_time);
  const playDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: b.timezone,
  }).format(start); // YYYY-MM-DD
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: b.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(start);
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  return {
    playDate,
    playTime: `${hh}:${mm}`,
    durationMin: Math.round((end.getTime() - start.getTime()) / 60_000),
  };
}

/** Seed the Find-Players composer from a booking. */
function fromBooking(b: CourtBooking): ComposerInitialSession {
  const { playDate, playTime, durationMin } = bookingParts(b);
  return {
    playDate,
    playTime,
    playDuration: durationMin,
    courtLocation: b.venue_name,
    courtFacilityId: b.facility_id,
    courtBooked: true,
  };
}

function fmtWhen(b: CourtBooking): string {
  const start = new Date(b.start_time);
  const end = new Date(b.end_time);
  const opts: Intl.DateTimeFormatOptions = { timeZone: b.timezone };
  const day = start.toLocaleDateString("en-US", {
    ...opts,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const t = (d: Date) =>
    d
      .toLocaleTimeString("en-US", {
        ...opts,
        hour: "numeric",
        minute: "2-digit",
      })
      .replace(":00", "")
      .replace(" ", "")
      .toLowerCase();
  return `${day} · ${t(start)}–${t(end)}`;
}

function BookingCard({
  b,
  isPast,
  onCancel,
  onFindPlayers,
  busy,
}: {
  b: CourtBooking;
  isPast: boolean;
  onCancel: (b: CourtBooking) => void;
  onFindPlayers: (b: CourtBooking) => void;
  busy: boolean;
}) {
  const cancelled = b.status === "cancelled";
  const hasSession = !!b.session_post_id;
  return (
    <li
      className={`bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-4 ${
        cancelled ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 truncate">{b.venue_name}</p>
          <p className="text-sm text-gray-600 mt-0.5">
            {shortCourtName(b.court_name)} · {fmtWhen(b)}
          </p>
          <p className="text-[11px] text-gray-400 mt-1">
            {cancelled
              ? "Cancelled"
              : b.receipt_number
                ? `Receipt ${b.receipt_number}`
                : "Confirmed"}
          </p>
        </div>
        {b.facility_id && (
          <Link
            href={`/courts/${encodeURIComponent(b.facility_id)}`}
            className="shrink-0 text-xs font-semibold text-court-green hover:underline"
          >
            View court
          </Link>
        )}
      </div>

      {!cancelled && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {hasSession ? (
            <Link
              href={`/p/${b.session_post_id}`}
              className="px-3 py-1.5 rounded-lg bg-court-green-soft/10 text-court-green text-xs font-semibold hover:bg-court-green-soft/20"
            >
              Session created ✓
            </Link>
          ) : (
            !isPast && (
              <button
                onClick={() => onFindPlayers(b)}
                className="px-3 py-1.5 rounded-lg bg-court-green text-white text-xs font-semibold hover:bg-court-green-light"
              >
                Find players
              </button>
            )
          )}
          <a
            href="/seattle/myaccount"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-xs font-semibold hover:bg-gray-200"
          >
            Manage on Seattle Parks
          </a>
          <button
            onClick={() => onCancel(b)}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-500 text-xs font-semibold hover:bg-red-500 hover:text-white disabled:opacity-50"
          >
            Mark cancelled
          </button>
        </div>
      )}
    </li>
  );
}

export default function BookingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showPast, setShowPast] = useState(false);
  // The booking we're spawning a find-players post for (opens the composer).
  const [composerFor, setComposerFor] = useState<CourtBooking | null>(null);

  const query = useCachedQuery(
    status === "authenticated" ? BOOKINGS_CACHE_KEY : null,
    () => listMyBookings(createSupabaseBrowserClient())
  );
  const bookings = query.data;

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const up: CourtBooking[] = [];
    const pa: CourtBooking[] = [];
    for (const b of bookings ?? []) {
      (new Date(b.end_time).getTime() >= now ? up : pa).push(b);
    }
    // listMyBookings returns start_time desc; upcoming reads better ascending.
    up.reverse();
    return { upcoming: up, past: pa };
  }, [bookings]);

  const onSessionPosted = async (post: Record<string, unknown>) => {
    const booking = composerFor;
    setComposerFor(null);
    const postId = typeof post.id === "string" ? post.id : null;
    if (!booking || !postId) return;
    // Optimistically flip the card to "Session created", then persist the link.
    query.mutate((prev) =>
      (prev ?? []).map((x) =>
        x.id === booking.id ? { ...x, session_post_id: postId } : x
      )
    );
    try {
      await linkBookingSession(createSupabaseBrowserClient(), booking.id, postId);
      await query.refetch();
    } catch (err) {
      setError(errorMessage(err, "Couldn't link the session."));
      await query.refetch();
    }
  };

  const cancel = async (b: CourtBooking) => {
    setError("");
    setBusyId(b.id);
    query.mutate((prev) =>
      (prev ?? []).map((x) =>
        x.id === b.id ? { ...x, status: "cancelled" } : x
      )
    );
    try {
      await markBookingCancelled(createSupabaseBrowserClient(), b.id);
      await query.refetch();
    } catch (err) {
      setError(errorMessage(err, "Couldn't cancel the booking."));
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
        <h1 className="font-display text-2xl font-bold text-court-green">My bookings</h1>
      </div>

      <p className="text-sm text-gray-500 mb-4">
        Courts you&apos;ve reserved on Seattle Parks through the app. Cancelling a
        reservation is done on Seattle Parks — use{" "}
        <span className="font-medium">Manage on Seattle Parks</span>.
      </p>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {bookings === undefined ? (
        <div className="space-y-3">
          <div className="skeleton w-full h-24 rounded-2xl" />
          <div className="skeleton w-full h-24 rounded-2xl" />
        </div>
      ) : upcoming.length === 0 && past.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-8 text-center">
          <div className="text-3xl mb-2">🎾</div>
          <p className="text-sm font-semibold text-gray-900">No bookings yet</p>
          <p className="text-sm text-gray-500 mt-1">
            Find an open court and tap a time to book it in the app.
          </p>
          <Link
            href="/courts"
            className="inline-block mt-4 px-4 py-2 rounded-lg bg-court-green text-white text-sm font-semibold hover:bg-court-green-light"
          >
            Browse courts
          </Link>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <ul className="space-y-3">
              {upcoming.map((b) => (
                <BookingCard
                  key={b.id}
                  b={b}
                  isPast={false}
                  onCancel={cancel}
                  onFindPlayers={setComposerFor}
                  busy={busyId === b.id}
                />
              ))}
            </ul>
          )}

          {past.length > 0 && (
            <div className="mt-6">
              <button
                onClick={() => setShowPast((s) => !s)}
                className="text-sm font-semibold text-gray-500 hover:text-gray-700"
              >
                {showPast ? "Hide" : "Show"} past bookings ({past.length})
              </button>
              {showPast && (
                <ul className="space-y-3 mt-3">
                  {past.map((b) => (
                    <BookingCard
                      key={b.id}
                      b={b}
                      isPast
                      onCancel={cancel}
                      onFindPlayers={setComposerFor}
                      busy={busyId === b.id}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {composerFor && (
        <ComposerModal
          session={session}
          placeholder="Looking for a player…"
          initialSession={fromBooking(composerFor)}
          onPost={onSessionPosted}
          onClose={() => setComposerFor(null)}
        />
      )}
    </div>
  );
}
