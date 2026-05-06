"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import { buildGoogleCalendarUrl, downloadIcs } from "@/lib/calendarExport";

type CalendarEvent = {
  id: string;
  playDate: string;
  playTime: string;
  playDuration: number;
  courtLocation: string;
  gameType: string;
  playersNeeded: number;
  playersConfirmed: number;
  courtBooked: boolean;
  isComplete: boolean;
  content: string;
  role: "creator" | "player" | "none";
  author: { id: string; name: string; profileImageUrl: string };
  groups: { id: string; name: string }[];
};

type GroupOption = { id: string; name: string };

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>("all");
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [view, setView] = useState<"calendar" | "list">("calendar");

  const loadEvents = (groupId?: string) => {
    const url = groupId && groupId !== "all"
      ? `/api/calendar?groupId=${groupId}`
      : "/api/calendar";
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        setEvents(data.events || []);
        setGroups(data.userGroups || []);
      });
  };

  useEffect(() => {
    loadEvents(selectedGroup);
  }, [selectedGroup]);

  // Build event map by date
  const eventsByDate = new Map<string, CalendarEvent[]>();
  events.forEach((ev) => {
    const d = parseDate(ev.playDate);
    if (d) {
      const key = dateKey(d);
      if (!eventsByDate.has(key)) eventsByDate.set(key, []);
      eventsByDate.get(key)!.push(ev);
    }
  });

  // Calendar grid
  const { year, month } = currentMonth;
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startPad = firstDay.getDay();
  const totalDays = lastDay.getDate();

  const prevMonth = () => {
    setCurrentMonth((p) =>
      p.month === 0 ? { year: p.year - 1, month: 11 } : { year: p.year, month: p.month - 1 }
    );
  };
  const nextMonth = () => {
    setCurrentMonth((p) =>
      p.month === 11 ? { year: p.year + 1, month: 0 } : { year: p.year, month: p.month + 1 }
    );
  };

  const today = dateKey(new Date());

  const selectedEvents = selectedDate ? (eventsByDate.get(selectedDate) || []) : [];

  // Today and future events only, sorted for list view
  const sortedEvents = events
    .filter((ev) => ev.playDate >= today)
    .sort((a, b) => a.playDate.localeCompare(b.playDate) || a.playTime.localeCompare(b.playTime));

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="animate-fade-in-up">
        <div className="flex items-center justify-between mb-1">
          <h1 className="font-display text-2xl font-bold text-court-green">
            My Calendar
          </h1>
          <div className="flex items-center gap-1 bg-white rounded-xl p-1 shadow-sm border border-court-green-pale/20">
            <button
              onClick={() => setView("calendar")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${view === "calendar" ? "bg-court-green text-white" : "text-gray-500 hover:text-gray-700"}`}
            >
              Calendar
            </button>
            <button
              onClick={() => setView("list")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${view === "list" ? "bg-court-green text-white" : "text-gray-500 hover:text-gray-700"}`}
            >
              List
            </button>
          </div>
        </div>
        <p className="text-gray-500 text-sm mb-6">Your upcoming games and matches</p>
      </div>

      {/* Group filter */}
      {groups.length > 0 && (
        <div className="animate-fade-in-up stagger-1 mb-6 flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filter:</span>
          <select
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
            className="px-3 py-2 rounded-xl text-sm font-semibold bg-white border border-gray-200 text-gray-700 focus:outline-none focus:ring-2 focus:ring-court-green/20 focus:border-court-green appearance-none pr-8"
            style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2.5' stroke-linecap='round'%3E%3Cpolyline points='6,9 12,15 18,9'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 0.75rem center" }}
          >
            <option value="all">All Games</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
      )}

      {view === "calendar" ? (
        <>
          {/* Calendar */}
          <div className="animate-fade-in-up stagger-2 bg-white rounded-2xl shadow-sm border border-court-green-pale/20 overflow-hidden">
            {/* Month nav */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15,18 9,12 15,6" /></svg>
              </button>
              <h2 className="font-display text-lg font-bold text-gray-800">
                {MONTH_NAMES[month]} {year}
              </h2>
              <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9,18 15,12 9,6" /></svg>
              </button>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 border-b border-gray-100">
              {DAY_NAMES.map((d) => (
                <div key={d} className="text-center text-xs font-semibold text-gray-400 py-2">{d}</div>
              ))}
            </div>

            {/* Days grid */}
            <div className="grid grid-cols-7">
              {Array.from({ length: startPad }).map((_, i) => (
                <div key={`pad-${i}`} className="h-16 border-b border-r border-gray-50" />
              ))}
              {Array.from({ length: totalDays }).map((_, i) => {
                const day = i + 1;
                const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const dayEvents = eventsByDate.get(key) || [];
                const isToday = key === today;
                const isSelected = key === selectedDate;
                const hasComplete = dayEvents.some((e) => e.isComplete);
                const hasOpen = dayEvents.some((e) => !e.isComplete);

                return (
                  <button
                    key={key}
                    onClick={() => setSelectedDate(isSelected ? null : key)}
                    className={`h-16 border-b border-r border-gray-50 flex flex-col items-center justify-start pt-1.5 transition-all relative ${
                      isSelected ? "bg-court-green-soft/10 ring-1 ring-inset ring-court-green-soft/30" : "hover:bg-gray-50"
                    }`}
                  >
                    <span className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full ${
                      isToday ? "bg-court-green text-white" : isSelected ? "text-court-green font-bold" : "text-gray-700"
                    }`}>
                      {day}
                    </span>
                    {dayEvents.length > 0 && (
                      <div className="flex items-center gap-0.5 mt-1">
                        {hasOpen && <div className="w-1.5 h-1.5 rounded-full bg-ball-yellow" />}
                        {hasComplete && <div className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-4">
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <div className="w-2 h-2 rounded-full bg-ball-yellow" /> Open Game
              </span>
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <div className="w-2 h-2 rounded-full bg-green-500" /> Confirmed
              </span>
            </div>
          </div>

          {/* Selected date events */}
          {selectedDate && (
            <div className="mt-5 space-y-3 animate-fade-in-up">
              <h3 className="text-sm font-bold text-gray-700">
                {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </h3>
              {selectedEvents.length === 0 ? (
                <p className="text-sm text-gray-400 bg-white rounded-xl p-4 shadow-sm border border-court-green-pale/20">No games on this day.</p>
              ) : (
                selectedEvents.map((ev) => <EventCard key={ev.id} event={ev} />)
              )}
            </div>
          )}
        </>
      ) : (
        /* List view */
        <div className="space-y-3 animate-fade-in-up stagger-2">
          {sortedEvents.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-court-green-pale/20">
              <div className="w-14 h-14 bg-ball-yellow/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-court-green-soft" strokeLinecap="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <h3 className="font-display text-lg font-bold text-gray-800 mb-2">No games yet</h3>
              <p className="text-gray-500 text-sm">Create a &quot;Find Players&quot; post to schedule a game!</p>
            </div>
          ) : (
            sortedEvents.map((ev) => <EventCard key={ev.id} event={ev} />)
          )}
        </div>
      )}
    </div>
  );
}

function EventCard({ event: ev }: { event: CalendarEvent }) {
  const roleBadge = ev.role === "creator"
    ? { label: "Organizer", cls: "bg-court-green text-white" }
    : ev.role === "player"
    ? { label: "Playing", cls: "bg-green-100 text-green-700" }
    : null;

  return (
    <Link
      href={`/?post=${ev.id}`}
      className={`block bg-white rounded-xl shadow-sm border p-4 card-hover ${ev.isComplete ? "border-green-200" : "border-court-green-pale/20"}`}
    >
      <div className="flex items-start gap-3">
        {/* Time block */}
        <div className={`w-14 shrink-0 rounded-xl text-center py-2 ${ev.isComplete ? "bg-green-50" : "bg-court-green/5"}`}>
          <p className="text-[10px] font-bold text-gray-400 uppercase">
            {parseDate(ev.playDate)?.toLocaleDateString("en-US", { month: "short" })}
          </p>
          <p className="text-xl font-bold text-gray-800">
            {parseDate(ev.playDate)?.getDate()}
          </p>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${ev.isComplete ? "bg-green-600 text-white" : "bg-ball-yellow/30 text-court-green"}`}>
              {ev.isComplete ? "Confirmed" : "Open"}
            </span>
            {roleBadge && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${roleBadge.cls}`}>
                {roleBadge.label}
              </span>
            )}
            <span className="text-xs font-semibold text-gray-800 capitalize">{ev.gameType}</span>
          </div>

          <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
            <span className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" /></svg>
              {ev.playTime}{ev.playDuration ? ` · ${ev.playDuration} min` : ""}
            </span>
            <span className="flex items-center gap-1 truncate">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
              {ev.courtLocation}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Avatar name={ev.author.name} image={ev.author.profileImageUrl} size="sm" />
              <span className="text-xs text-gray-500">{ev.author.name}</span>
            </div>
            <span className="text-xs text-gray-400">{ev.playersConfirmed}/{ev.playersNeeded} players</span>
            {ev.courtBooked && (
              <span className="text-xs text-green-600 font-medium">Court booked</span>
            )}
          </div>

          {ev.groups.length > 0 && (
            <div className="flex items-center gap-1 mt-2">
              {ev.groups.map((g) => (
                <span key={g.id} className="text-[10px] font-medium text-court-green-soft bg-court-green-soft/10 px-2 py-0.5 rounded-full">{g.name}</span>
              ))}
            </div>
          )}

          {ev.isComplete && (
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-green-100/70">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Add to calendar</span>
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); downloadIcs(ev); }}
                className="text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
              >
                Apple / .ics
              </button>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  window.open(buildGoogleCalendarUrl(ev), "_blank", "noopener,noreferrer");
                }}
                className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
              >
                Google
              </button>
            </div>
          )}
        </div>
      </div>
    </Link>
  );

  function parseDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    const d = new Date(dateStr + "T00:00:00");
    return isNaN(d.getTime()) ? null : d;
  }
}
