"use client";

// Live tennis-court availability for one Seattle Parks venue, backed by the
// public ActiveNet endpoints via /api/courts/availability. Renders a time grid
// — rows are courts, columns are hours (7a, 8a, …), and open windows fill the
// cells — plus a 15-day date selector. Replaces the old "in progress"
// placeholder (and, on the detail page, the Power BI dashboard) for any venue
// we can resolve to an ActiveNet center.

import { useEffect, useRef, useState } from "react";
import { buildSlotBookingUrl, type Timeslot } from "@/lib/activenet";
import { getCourtByResourceId } from "@/lib/activenetSeattleCourts";
import {
  bookingEndTimes,
  bookingStartTimes,
  SEATTLE_OUTDOOR_MIN_MINUTES,
  snapBookingRange,
} from "@/lib/bookingWindow";
import { clockToMinutes as toMinutes } from "@/lib/courtAvailability";
import BookingSheet from "./BookingSheet";

interface CourtAvailability {
  resourceId: number;
  courtName: string;
  slots: Timeslot[];
  error: boolean;
  reservable: boolean;
}

interface BookingSlot {
  resourceId: number;
  courtName: string;
  date: string;
  startTime: string;
  endTime: string;
  url: string;
}

interface AvailabilityGridProps {
  /** ActiveNet center ID for the venue. */
  centerId: number;
  venueName: string;
  /** Catalog facility id ("tf-N") for the venue, saved with a booking so it
   *  links back to the court page. Null for venues not in the catalog. */
  facilityId?: string | null;
  /** Venue booking URL, present when the venue supports online booking. */
  bookingUrl?: string | null;
  /** Official "live / today" view (Seattle Parks dashboard). Linked from the
   *  view-only notice on days where online booking is closed (e.g. today,
   *  where same-day reservations aren't offered but courts can be checked). */
  liveViewUrl?: string | null;
  /** Open on this date instead of today (e.g. arriving from the map's
   *  "find open courts" filter). Ignored if outside the 15-day window. */
  initialDate?: string | null;
  /** Searched time window ("HH:mm") to highlight + scroll into view on the
   *  initialDate. */
  highlightStart?: string | null;
  highlightEnd?: string | null;
  /** For a venue sharing an ActiveNet center with another (Lower/Upper
   *  Woodland), only keep courts whose name includes this substring. */
  courtFilter?: string | null;
}

// ActiveNet exposes today + the next 14 days (the official site's 15-day
// window). Today is view-only (no same-day online booking); the other 14 are
// bookable. Day 15+ falls outside the window, so we don't offer those tabs.
const DAYS_SHOWN = 15;

// Timeline column width. Wide enough that even a 30-min bar (½ hour)
// comfortably fits its time label inside.
const PX_PER_HOUR = 92;
const TIME_SELECT_CLASS = "block min-h-11 w-full rounded-lg border border-gray-300 bg-white px-2.5 text-base text-gray-900 disabled:bg-gray-100 disabled:text-gray-600";

// Seattle Parks tennis reservation line (Amy Yee Tennis Center) — used to
// reserve walk-on / non-online-bookable courts by phone.
const RESERVE_PHONE = "(206) 684-4764";

/** Local YYYY-MM-DD (the date the user is standing in, not UTC). */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function nextDays(count: number): Date[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d;
  });
}

/** Minutes from midnight → "HH:mm". */
function toClock24(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Compact column header for an hour: 7a, 12p, 1p, 9p. */
function hourLabel(h: number): string {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${h < 12 ? "a" : "p"}`;
}

/** Compact clock from minutes: 420→"7", 1035→"5:15". */
function clockFromMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}` : `${h12}:${String(m).padStart(2, "0")}`;
}

function timeLabel(min: number): string {
  const clock = clockFromMinutes(min);
  return `${clock.includes(":") ? clock : `${clock}:00`} ${min % 1440 < 720 ? "AM" : "PM"}`;
}

/** Label written on a bar: "7–8a", "5:15–9p", "11:30a–12:30p" (am/pm shown
 *  once when start and end share it). */
function formatRangeShort(startMin: number, endMin: number): string {
  const sp = startMin < 720 ? "a" : "p";
  const ep = endMin < 720 || endMin === 1440 ? "a" : "p";
  return sp === ep
    ? `${clockFromMinutes(startMin)}–${clockFromMinutes(endMin)}${ep}`
    : `${clockFromMinutes(startMin)}${sp}–${clockFromMinutes(endMin)}${ep}`;
}

/** "AYTC Outdoor Tennis Court 01" → "Court 01"; otherwise the full name. */
function shortCourtName(name: string): string {
  // Drop a trailing sub-group tag like "(Lower)" — once the table is filtered
  // to one venue it's redundant on every row.
  const cleaned = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const m = cleaned.match(/(court\s+\S+)\s*$/i);
  return m ? m[1].replace(/^c/, "C") : cleaned;
}

export default function AvailabilityGrid({
  centerId,
  venueName,
  facilityId,
  bookingUrl,
  liveViewUrl,
  initialDate,
  highlightStart,
  highlightEnd,
  courtFilter,
}: AvailabilityGridProps) {
  const [days] = useState<Date[]>(() => nextDays(DAYS_SHOWN));
  const [selected, setSelected] = useState<string>(() =>
    initialDate && nextDays(DAYS_SHOWN).some((d) => ymd(d) === initialDate)
      ? initialDate
      : ymd(new Date())
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const startTimeRef = useRef<HTMLSelectElement>(null);
  const [courts, setCourts] = useState<CourtAvailability[] | null>(null);
  const [dayStatus, setDayStatus] = useState<number | null>(null);
  const [source, setSource] = useState<"live" | "snapshot">("live");
  const [snapshotAsOf, setSnapshotAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  // Keep the slot in TennisFriend while the reservation opens in a new tab.
  const [bookingSlot, setBookingSlot] = useState<BookingSlot | null>(null);
  const [selection, setSelection] = useState<{
    startMin: number;
    endMin: number;
    resourceId: number | null;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function load() {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(
          `/api/courts/availability?center=${centerId}&date=${selected}`,
          { signal }
        );
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as {
          courts: CourtAvailability[];
          dayStatus: number | null;
          source?: "live" | "snapshot";
          snapshotAsOf?: string | null;
        };
        if (signal.aborted) return;
        const courts = courtFilter
          ? data.courts.filter((c) => c.courtName.includes(courtFilter))
          : data.courts;
        setCourts(courts);
        setDayStatus(data.dayStatus);
        setSource(data.source ?? "live");
        setSnapshotAsOf(data.snapshotAsOf ?? null);
      } catch {
        if (signal.aborted) return;
        setError(true);
        setCourts(null);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [centerId, selected, courtFilter, retryCount]);

  const availabilityUnavailable = error || !courts?.some((court) => !court.error);
  const totalOpen = courts?.reduce((n, c) => n + c.slots.length, 0) ?? 0;
  // Snapshot = today served from last night's frozen schedule (same-day isn't
  // bookable online). Windows are shown for reference, not as booking links.
  const isSnapshot = source === "snapshot";
  // A non-zero day status with nothing bookable AND no snapshot means online
  // booking is closed for this day (same-day / out-of-window) rather than
  // "fully booked" — show a view-only notice instead of a wall of "No open
  // times".
  const viewOnly = !isSnapshot && totalOpen === 0 && dayStatus != null && dayStatus !== 0;
  const officialUrl = liveViewUrl || bookingUrl || null;

  // Build the timeline: each court's open windows as exact-minute bars, plus
  // the global hour span (rounded out to whole hours) used as the axis. Bars
  // are positioned proportionally so a 5:15pm start visibly begins a quarter
  // into the 5p column.
  const allRows = (courts ?? []).map((c) => ({
    resourceId: c.resourceId,
    name: shortCourtName(c.courtName),
    fullName: c.courtName,
    error: c.error,
    reservable: c.reservable,
    bars: c.slots.map((s) => ({
      start: toMinutes(s.startTime),
      end: toMinutes(s.endTime),
    })),
  }));
  // Every court's availability is shown. Non-reservable (walk-on / phone-only)
  // courts are drawn in a muted colour and aren't booking links.
  const courtRows = allRows;
  const hasNonReservable = allRows.some((c) => !c.reservable);
  const onlineBooking = !!bookingUrl && !isSnapshot;
  const reservableCourts = onlineBooking ? courtRows.filter((c) => c.reservable) : [];
  const openWindows = reservableCourts.flatMap((c) => c.bars);
  const startTimes = bookingStartTimes(openWindows);
  const endTimes = selection ? bookingEndTimes(openWindows, selection.startMin) : [];
  const matchingCourts = selection
    ? reservableCourts.filter((c) =>
        c.bars.some((b) => b.start <= selection.startMin && b.end >= selection.endMin)
      )
    : [];
  const requestedCourtId = selection?.resourceId ?? null;
  const selectedCourt = requestedCourtId === null
    ? matchingCourts[0]
    : matchingCourts.find((court) => court.resourceId === requestedCourtId);
  const needsAnotherCourt = requestedCourtId !== null && !selectedCourt;
  let selectedBooking: BookingSlot | null = null;
  if (selection && selectedCourt) {
    const slot = {
      resourceId: selectedCourt.resourceId,
      courtName: selectedCourt.fullName,
      date: selected,
      startTime: toClock24(selection.startMin),
      endTime: toClock24(selection.endMin),
    };
    selectedBooking = {
      ...slot,
      url: buildSlotBookingUrl({
        ...slot,
        centerId,
        courtName: getCourtByResourceId(slot.resourceId)?.bookingSearchName ?? slot.courtName,
      }),
    };
  }

  function chooseStartTime(startMin: number) {
    const duration = selection ? selection.endMin - selection.startMin : SEATTLE_OUTDOOR_MIN_MINUTES;
    const ends = bookingEndTimes(openWindows, startMin);
    const endMin = ends.find((time) => time >= startMin + duration) ?? ends.at(-1);
    if (endMin === undefined) return;
    setSelection({ startMin, endMin, resourceId: requestedCourtId ?? selectedCourt?.resourceId ?? null });
  }

  let minMin = Infinity;
  let maxMin = -Infinity;
  for (const c of courtRows) {
    for (const b of c.bars) {
      if (b.start < minMin) minMin = b.start;
      if (b.end > maxMin) maxMin = b.end;
    }
  }
  const hasWindows = maxMin > minMin;
  const axisStartH = hasWindows ? Math.floor(minMin / 60) : 0;
  const axisEndH = hasWindows ? Math.ceil(maxMin / 60) : 0;
  const spanHours = axisEndH - axisStartH;
  const trackWidth = spanHours * PX_PER_HOUR;
  const hourTicks = Array.from({ length: spanHours }, (_, i) => axisStartH + i);
  const LABEL_W = 78; // court-name column width in px

  // Highlight + scroll-to the time window the user searched on the map filter,
  // but only on the date they searched.
  const showHighlight =
    hasWindows && !!highlightStart && !!highlightEnd && !!initialDate && selected === initialDate;
  const clampPx = (px: number) => Math.max(0, Math.min(trackWidth, px));
  const hlLeft = highlightStart ? clampPx((toMinutes(highlightStart) / 60 - axisStartH) * PX_PER_HOUR) : 0;
  const hlRight = highlightEnd ? clampPx((toMinutes(highlightEnd) / 60 - axisStartH) * PX_PER_HOUR) : 0;
  const hlWidth = Math.max(0, hlRight - hlLeft);

  useEffect(() => {
    if (!showHighlight || loading) return;
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, hlLeft - 12);
  }, [showHighlight, loading, hlLeft]);

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      {/* Date selector */}
      <div className="flex gap-1.5 overflow-x-auto px-3 py-3 border-b border-gray-100 bg-gray-50/60">
        {days.map((d) => {
          const key = ymd(d);
          const isToday = key === ymd(new Date());
          const active = key === selected;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => {
                if (active) return;
                setLoading(true);
                setSelected(key);
                setSelection(null);
              }}
              className={`flex flex-col items-center shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                active
                  ? "bg-court-green text-white"
                  : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
              }`}
            >
              <span>
                {isToday
                  ? "Today"
                  : d.toLocaleDateString([], { weekday: "short" })}
              </span>
              <span className={active ? "text-white/90" : "text-gray-400"}>
                {d.toLocaleDateString([], { month: "numeric", day: "numeric" })}
              </span>
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div className="p-3">
        {loading ? (
          <div className="space-y-2 animate-pulse">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-4 w-16 bg-gray-200 rounded" />
                <div className="h-6 flex-1 bg-gray-100 rounded" />
              </div>
            ))}
          </div>
        ) : availabilityUnavailable ? (
          <div className="py-6 text-center">
            <p className="text-sm text-gray-600">
              {error || courts?.length ? "Couldn't load availability." : `No court data for ${venueName}.`}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setRetryCount((count) => count + 1)}
                className="min-h-11 px-2 text-sm font-semibold text-court-green hover:underline"
              >
                Try again
              </button>
              {bookingUrl && (
                <a
                  href={bookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary inline-flex min-h-11 items-center justify-center px-3 text-sm"
                >
                  Book directly on Seattle Parks
                </a>
              )}
            </div>
          </div>
        ) : viewOnly ? (
          <div className="py-5 px-1 text-center">
            <p className="text-sm font-medium text-gray-700">
              Same-day reservations aren&apos;t offered online here.
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Courts may still be free to walk on — check today&apos;s court
              status on Seattle Parks, or pick another day above to book ahead.
            </p>
            {officialUrl && (
              <a
                href={officialUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-court-green hover:underline"
              >
                Check on Seattle Parks
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            )}
          </div>
        ) : (
          <>
            {isSnapshot && (
              <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                <p className="text-xs text-amber-800">
                  Same-day booking isn&apos;t offered online, so these are
                  today&apos;s windows as they stood last night — for reference,
                  not booking. Pick another day to book ahead.
                </p>
              </div>
            )}
            {startTimes.length > 0 && (
              <fieldset className="mb-4 rounded-xl border border-court-green/20 bg-court-green/5 px-3 pb-3 pt-2">
                <legend className="px-1 text-sm font-semibold text-court-green">Choose a time</legend>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  <label className="min-w-0 space-y-1">
                    <span className="block text-sm font-medium text-gray-700">Start time</span>
                    <select
                      ref={startTimeRef}
                      value={selection?.startMin ?? ""}
                      onChange={(event) => chooseStartTime(Number(event.target.value))}
                      className={TIME_SELECT_CLASS}
                    >
                      <option value="" disabled>Select time</option>
                      {startTimes.map((time) => (
                        <option key={time} value={time}>{timeLabel(time)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="min-w-0 space-y-1">
                    <span className="block text-sm font-medium text-gray-700">End time</span>
                    <select
                      value={selection?.endMin ?? ""}
                      disabled={!selection}
                      onChange={(event) => {
                        if (!selection) return;
                        setSelection({
                          ...selection,
                          endMin: Number(event.target.value),
                          resourceId: requestedCourtId ?? selectedCourt?.resourceId ?? null,
                        });
                      }}
                      className={TIME_SELECT_CLASS}
                    >
                      <option value="" disabled>Select time</option>
                      {endTimes.map((time) => (
                        <option key={time} value={time}>{timeLabel(time)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="col-span-2 min-w-0 space-y-1 sm:col-span-1">
                    <span className="block text-sm font-medium text-gray-700">Court</span>
                    <select
                      value={selectedCourt?.resourceId ?? ""}
                      disabled={matchingCourts.length === 0}
                      onChange={(event) => {
                        if (!selection) return;
                        setSelection({ ...selection, resourceId: Number(event.target.value) });
                      }}
                      className={TIME_SELECT_CLASS}
                    >
                      <option value="" disabled>
                        {needsAnotherCourt ? "Choose another court" : "Choose a time first"}
                      </option>
                      {matchingCourts.map((court) => (
                        <option key={court.resourceId} value={court.resourceId}>{court.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <p aria-live="polite" className={needsAnotherCourt ? "mt-2 text-sm text-amber-900" : undefined}>
                  {needsAnotherCourt && "Your selected court is unavailable for this time. Choose another court to book."}
                </p>
                {selectedBooking ? (
                  <a
                    href={selectedBooking.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setBookingSlot(selectedBooking)}
                    className="btn-primary mt-3 inline-flex min-h-11 w-full items-center justify-center px-4 text-sm sm:w-auto"
                  >
                    Book on Seattle Parks<span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="mt-3 min-h-11 w-full rounded-lg bg-gray-200 px-4 text-sm font-semibold text-gray-600 sm:w-auto"
                  >
                    Book on Seattle Parks
                  </button>
                )}
              </fieldset>
            )}
            {!hasWindows ? (
              <p className="py-6 text-center text-sm text-gray-400">
                {isSnapshot
                  ? "No courts were open as of last night."
                  : "No open times on this day."}
              </p>
            ) : (
              <div className="overflow-x-auto" ref={scrollRef}>
                <div style={{ width: LABEL_W + trackWidth }}>
                  {/* Hour axis */}
                  <div className="flex">
                    <div
                      className="sticky left-0 z-10 bg-white shrink-0"
                      style={{ width: LABEL_W }}
                    />
                    <div className="relative h-4 shrink-0" style={{ width: trackWidth }}>
                      {hourTicks.map((h, i) => (
                        <span
                          key={h}
                          className="absolute top-0 text-[10px] font-medium text-gray-400"
                          style={{ left: i * PX_PER_HOUR + 2 }}
                        >
                          {hourLabel(h)}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* One track per court, bars positioned by exact minute. */}
                  <div className="relative">
                    {/* Highlight band over the time window searched on the map. */}
                    {showHighlight && hlWidth > 0 && (
                      <div
                        className="absolute top-0 bottom-0 bg-court-green/[0.07] border-x border-court-green/30 pointer-events-none"
                        style={{ left: LABEL_W + hlLeft, width: hlWidth }}
                      />
                    )}
                    {courtRows.map((c) => (
                    <div key={c.resourceId} className="flex border-t border-gray-100">
                      <div
                        className="sticky left-0 z-10 bg-white shrink-0 flex items-center justify-end pr-2.5 border-r border-gray-200 text-xs font-semibold text-gray-700 whitespace-nowrap"
                        style={{ width: LABEL_W }}
                      >
                        {c.name}
                      </div>
                      <div
                        className="relative shrink-0 h-7"
                        style={{
                          width: trackWidth,
                          backgroundImage: `repeating-linear-gradient(to right, rgba(0,0,0,0.05) 0, rgba(0,0,0,0.05) 1px, transparent 1px, transparent ${PX_PER_HOUR}px)`,
                        }}
                      >
                        {c.bars.map((b, idx) => {
                          const left = (b.start / 60 - axisStartH) * PX_PER_HOUR;
                          const width = ((b.end - b.start) / 60) * PX_PER_HOUR;
                          const label = formatRangeShort(b.start, b.end);
                          const selectable =
                            onlineBooking && c.reservable && b.end - b.start >= SEATTLE_OUTDOOR_MIN_MINUTES;
                          const fill = !c.reservable
                            ? "bg-gray-300"
                            : selectable
                              ? "bg-ball-yellow"
                              : "bg-ball-yellow/50";
                          // Label is always centered ON the bar. For a bar too
                          // narrow to contain it, the text overhangs the edges
                          // symmetrically (no clipping) so it still reads as
                          // sitting on the block.
                          const common = `absolute inset-y-1 rounded-md flex items-center justify-center ${fill}`;
                          const text = (
                            <span
                              className={`px-1 text-[9px] font-semibold leading-none whitespace-nowrap ${
                                c.reservable ? "text-court-green" : "text-gray-600"
                              }`}
                            >
                              {label}
                            </span>
                          );
                          // The active selection, if it falls inside this bar.
                          const sel =
                            selectable &&
                            selection &&
                            selectedCourt?.resourceId === c.resourceId &&
                            selection.startMin >= b.start &&
                            selection.endMin <= b.end
                              ? selection
                              : null;
                          return selectable ? (
                            <button
                              key={idx}
                              type="button"
                              onClick={(event) => {
                                const rect = event.currentTarget.getBoundingClientRect();
                                const minute = event.detail === 0
                                  ? b.start
                                  : b.start + ((event.clientX - rect.left) / PX_PER_HOUR) * 60;
                                const range = snapBookingRange({
                                  barStartMin: b.start,
                                  barEndMin: b.end,
                                  anchorMin: minute,
                                  cursorMin: minute,
                                });
                                setSelection({ ...range, resourceId: c.resourceId });
                                startTimeRef.current?.scrollIntoView({ block: "center" });
                                startTimeRef.current?.focus({ preventScroll: true });
                              }}
                              aria-label={`${c.name}, ${timeLabel(b.start)} to ${timeLabel(b.end)}`}
                              aria-pressed={!!sel}
                              title={`${label} · choose a time on ${c.name}`}
                              style={{ left, width }}
                              className={`${common} hover:brightness-95 transition`}
                            >
                              {/* Hide the window label while a selection sits on
                                  this bar so it doesn't clash with the overlay. */}
                              {!sel && text}
                              {sel && (
                                <span
                                  className="absolute inset-y-0 rounded-md bg-court-green flex items-center justify-center pointer-events-none"
                                  style={{
                                    left: ((sel.startMin - b.start) / 60) * PX_PER_HOUR,
                                    width: ((sel.endMin - sel.startMin) / 60) * PX_PER_HOUR,
                                  }}
                                >
                                  <span className="px-1 text-[9px] font-semibold leading-none whitespace-nowrap text-white">
                                    {formatRangeShort(sel.startMin, sel.endMin)}
                                  </span>
                                </span>
                              )}
                            </button>
                          ) : (
                            <div title={label} style={{ left, width }} className={common} key={idx}>
                              {text}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {/* Legend + status line */}
            <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-600">
              <span className="flex items-center gap-1.5">
                <span
                  className={`inline-block w-4 h-2.5 rounded-full ${
                    isSnapshot ? "bg-ball-yellow/50" : "bg-ball-yellow"
                  }`}
                />
                {isSnapshot
                  ? `Available as of last night${snapshotAsOf ? ` (${new Date(snapshotAsOf).toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })})` : ""}`
                  : startTimes.length > 0
                    ? "Tap a yellow window to fill the time picker"
                    : "Open time"}
              </span>
              {hasNonReservable && (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-4 h-2.5 rounded-full bg-gray-300" />
                  Walk-on · reserve by phone
                </span>
              )}
            </div>
            {/* Walk-on / phone-only note */}
            {hasNonReservable && (
              <p className="mt-1.5 text-[11px] text-gray-500">
                Gray courts can&apos;t be reserved online — walk on, or call{" "}
                <a href={`tel:${RESERVE_PHONE.replace(/[^\d]/g, "")}`} className="text-court-green font-medium hover:underline">
                  {RESERVE_PHONE}
                </a>{" "}
                to reserve.
              </p>
            )}
          </>
        )}
      </div>

      {bookingSlot && (
        <BookingSheet
          resourceId={bookingSlot.resourceId}
          centerId={centerId}
          courtName={bookingSlot.courtName}
          venueName={venueName}
          facilityId={facilityId ?? null}
          date={bookingSlot.date}
          startTime={bookingSlot.startTime}
          endTime={bookingSlot.endTime}
          slotBookingUrl={bookingSlot.url}
          onClose={() => setBookingSlot(null)}
        />
      )}
    </div>
  );
}
