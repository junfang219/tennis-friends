"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

type TeamMatch = {
  id: string;
  matchDate: string;
  matchTime: string;
  location: string;
  notes: string;
};

type TeamPractice = {
  id: string;
  practiceDate: string;
  practiceTime: string;
  location: string;
  coach: string;
  cancelled: boolean;
  postId: string;
};

type CalendarEvent =
  | { kind: "match"; id: string; date: string; time: string; location: string; notes: string }
  | {
      kind: "practice";
      id: string;
      date: string;
      time: string;
      location: string;
      coach: string;
      cancelled: boolean;
      postId: string;
    };

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function dateKey(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDate(s: string) {
  return new Date(`${s}T00:00`);
}

function formatLongDate(s: string) {
  return parseDate(s).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function TeamCalendarPage() {
  const params = useParams();
  const router = useRouter();
  const groupId = params.id as string;

  const [teamName, setTeamName] = useState("");
  const [matches, setMatches] = useState<TeamMatch[]>([]);
  const [practices, setPractices] = useState<TeamPractice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [cursor, setCursor] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [teamRes, matchesRes, practicesRes] = await Promise.all([
        fetch(`/api/groups/${groupId}`),
        fetch(`/api/groups/${groupId}/matches`),
        fetch(`/api/groups/${groupId}/practices`),
      ]);
      if (!teamRes.ok) {
        setError(teamRes.status === 403 ? "You are not a member of this team." : "Failed to load team.");
        setLoading(false);
        return;
      }
      const teamData = await teamRes.json();
      setTeamName(teamData.name || "");
      if (matchesRes.ok) {
        const m = await matchesRes.json();
        setMatches(Array.isArray(m) ? m : []);
      }
      if (practicesRes.ok) {
        const p = await practicesRes.json();
        setPractices(Array.isArray(p) ? p : []);
      }
    } catch {
      setError("Something went wrong.");
    }
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const m of matches) {
      if (!m.matchDate) continue;
      const arr = map.get(m.matchDate) || [];
      arr.push({
        kind: "match",
        id: m.id,
        date: m.matchDate,
        time: m.matchTime,
        location: m.location,
        notes: m.notes,
      });
      map.set(m.matchDate, arr);
    }
    for (const p of practices) {
      if (!p.practiceDate) continue;
      const arr = map.get(p.practiceDate) || [];
      arr.push({
        kind: "practice",
        id: p.id,
        date: p.practiceDate,
        time: p.practiceTime,
        location: p.location,
        coach: p.coach,
        cancelled: p.cancelled,
        postId: p.postId,
      });
      map.set(p.practiceDate, arr);
    }
    for (const [, v] of map) {
      v.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    }
    return map;
  }, [matches, practices]);

  // Build the cells for the current month
  const calendarCells = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startWeekday = firstDay.getDay(); // 0=Sun

    const cells: ({ day: number; date: string } | null)[] = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month, day);
      cells.push({ day, date: dateKey(d) });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  const todayKey = dateKey(new Date());

  const goPrevMonth = () =>
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
  const goNextMonth = () =>
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
  const goToday = () => {
    const now = new Date();
    setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(todayKey);
  };

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-500">{error}</p>
        <button onClick={() => router.back()} className="btn-primary mt-4">Go Back</button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="skeleton w-48 h-8 mb-4" />
        <div className="skeleton w-full h-96" />
      </div>
    );
  }

  const selectedEvents = selectedDate ? eventsByDate.get(selectedDate) || [] : [];

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <Link href={`/groups/${groupId}`} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15,18 9,12 15,6" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-xl font-bold text-court-green truncate">{teamName}</h1>
          <p className="text-xs text-gray-500">Calendar</p>
        </div>
      </div>

      {/* Month nav */}
      <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-4 mb-4">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={goPrevMonth}
            className="w-9 h-9 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-500"
            aria-label="Previous month"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="15,18 9,12 15,6" />
            </svg>
          </button>
          <div className="flex items-center gap-3">
            <h2 className="font-display text-lg font-bold text-gray-900">
              {MONTH_LABELS[cursor.getMonth()]} {cursor.getFullYear()}
            </h2>
            <button onClick={goToday} className="text-xs font-semibold text-court-green hover:text-court-green-light px-2 py-1 rounded hover:bg-court-green-pale/20">
              Today
            </button>
          </div>
          <button
            onClick={goNextMonth}
            className="w-9 h-9 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-500"
            aria-label="Next month"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="9,18 15,12 9,6" />
            </svg>
          </button>
        </div>

        {/* Weekday header */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAY_LABELS.map((d) => (
            <div key={d} className="text-[10px] uppercase tracking-wider font-bold text-gray-400 text-center py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-1">
          {calendarCells.map((cell, i) => {
            if (!cell) return <div key={`pad-${i}`} className="aspect-square" />;
            const dayEvents = eventsByDate.get(cell.date) || [];
            const isToday = cell.date === todayKey;
            const isSelected = cell.date === selectedDate;
            const visible = dayEvents.slice(0, 3);
            const more = dayEvents.length - visible.length;
            return (
              <button
                key={cell.date}
                onClick={() => setSelectedDate(cell.date)}
                className={`relative aspect-square min-h-[64px] p-1 rounded-lg flex flex-col items-stretch gap-0.5 text-left transition-colors ${
                  isSelected
                    ? "bg-court-green-pale/30 ring-2 ring-court-green"
                    : isToday
                    ? "bg-ball-yellow/20 ring-2 ring-court-green"
                    : "bg-gray-50 hover:bg-court-green-pale/20"
                }`}
              >
                <span className={`text-[11px] font-semibold ${isToday ? "text-court-green" : "text-gray-700"}`}>
                  {cell.day}
                </span>
                <div className="flex flex-col gap-0.5 overflow-hidden">
                  {visible.map((e, idx) => {
                    const cancelled = e.kind === "practice" && e.cancelled;
                    const cls =
                      e.kind === "match"
                        ? "bg-court-green text-white"
                        : cancelled
                        ? "bg-gray-200 text-gray-400 line-through"
                        : "bg-ball-yellow text-court-green";
                    return (
                      <span
                        key={`${e.kind}-${e.id}-${idx}`}
                        className={`text-[8px] leading-tight font-semibold px-1 py-0.5 rounded truncate ${cls}`}
                      >
                        {e.kind === "match" ? "Match" : "Practice"}
                        {e.time ? ` ${e.time}` : ""}
                      </span>
                    );
                  })}
                  {more > 0 && (
                    <span className="text-[8px] text-gray-400 font-semibold px-1">+{more}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-3 mt-3 text-[10px] text-gray-500">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-court-green" /> Match
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-ball-yellow" /> Practice
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-gray-200" /> Cancelled
          </span>
        </div>
      </div>

      {/* Selected day panel */}
      {selectedDate && (
        <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-4 animate-fade-in-up">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-base font-bold text-gray-900">
              {formatLongDate(selectedDate)}
            </h3>
            <button
              onClick={() => setSelectedDate(null)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Close
            </button>
          </div>
          {selectedEvents.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No events on this day.</p>
          ) : (
            <div className="space-y-2">
              {selectedEvents.map((e, i) => {
                if (e.kind === "match") {
                  return (
                    <div
                      key={`${e.kind}-${e.id}-${i}`}
                      className="flex items-center justify-between gap-3 p-3 rounded-lg border border-court-green-pale/30 bg-court-green-pale/10"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-white bg-court-green px-2 py-0.5 rounded">
                            Match
                          </span>
                          {e.time && <span className="text-xs font-semibold text-gray-700">{e.time}</span>}
                        </div>
                        <p className="text-xs text-gray-600 mt-1">📍 {e.location}</p>
                        {e.notes && <p className="text-[11px] text-gray-400 italic mt-1">{e.notes}</p>}
                      </div>
                      <Link
                        href={`/groups/${groupId}/availability?focus=${e.id}`}
                        className="text-[11px] font-semibold text-court-green hover:text-court-green-light shrink-0"
                      >
                        Open →
                      </Link>
                    </div>
                  );
                }
                const cancelled = e.cancelled;
                return (
                  <div
                    key={`${e.kind}-${e.id}-${i}`}
                    className={`flex items-center justify-between gap-3 p-3 rounded-lg border ${
                      cancelled
                        ? "border-gray-200 bg-gray-50 opacity-70"
                        : "border-ball-yellow/40 bg-ball-yellow/10"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                            cancelled
                              ? "text-gray-500 bg-gray-200"
                              : "text-court-green bg-ball-yellow"
                          } ${cancelled ? "line-through" : ""}`}
                        >
                          Practice
                        </span>
                        {e.time && <span className="text-xs font-semibold text-gray-700">{e.time}</span>}
                        {cancelled && (
                          <span className="text-[10px] font-bold tracking-wider text-red-600 bg-red-100 px-2 py-0.5 rounded uppercase">
                            Cancelled
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-600 mt-1">📍 {e.location}</p>
                      {e.coach && (
                        <p className="text-[11px] text-gray-500 mt-1">👨‍🏫 Coach: {e.coach}</p>
                      )}
                    </div>
                    <Link
                      href={`/groups/${groupId}/practice?focus=${e.id}`}
                      className="text-[11px] font-semibold text-court-green hover:text-court-green-light shrink-0"
                    >
                      Open →
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Empty hint when no selection and no events at all in this month */}
      {!selectedDate &&
        Array.from(eventsByDate.keys()).every((k) => {
          const d = parseDate(k);
          return d.getFullYear() !== cursor.getFullYear() || d.getMonth() !== cursor.getMonth();
        }) && (
          <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-6 text-center text-sm text-gray-500">
            No events scheduled this month.
            <p className="text-xs text-gray-400 mt-2">
              Add matches via{" "}
              <Link href={`/groups/${groupId}/availability`} className="text-court-green font-semibold hover:underline">
                Availability
              </Link>{" "}
              or propose practices via{" "}
              <Link href={`/groups/${groupId}/practice`} className="text-court-green font-semibold hover:underline">
                Team Practice
              </Link>
              .
            </p>
          </div>
        )}
    </div>
  );
}
