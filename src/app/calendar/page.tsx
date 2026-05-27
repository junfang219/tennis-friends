"use client";

import { useState } from "react";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import { buildGoogleCalendarUrl, downloadIcs } from "@/lib/calendarExport";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useCachedQuery } from "@/lib/useCachedQuery";

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

type TeamMatchEvent = {
  id: string;
  teamId: string;
  teamName: string;
  matchDate: string;
  matchTime: string;
  location: string;
  notes: string;
  inLineup: boolean;
  lineupSlot: string;
};

type TeamPracticeEvent = {
  id: string;
  teamId: string;
  teamName: string;
  seriesId: string;
  seriesName: string;
  practiceDate: string;
  practiceTime: string;
  location: string;
  notes: string;
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

type CalendarBundle = {
  events: CalendarEvent[];
  matches: TeamMatchEvent[];
  practices: TeamPracticeEvent[];
  userGroups: GroupOption[];
};

export default function CalendarPage() {
  const [selectedGroup, setSelectedGroup] = useState<string>("all");
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [view, setView] = useState<"calendar" | "list">("calendar");

  // Replaces the deleted /api/calendar endpoint with direct Supabase queries.
  // Cache key includes the group filter so switching groups doesn't blow
  // away the "all" snapshot or vice-versa.
  const cacheKey = `calendar:${selectedGroup}`;
  const bundle = useCachedQuery<CalendarBundle>(cacheKey, async () => {
    const supabase = createSupabaseBrowserClient();
    const { data: auth } = await supabase.auth.getUser();
    const me = auth.user?.id;
    if (!me) {
      return { events: [], matches: [], practices: [], userGroups: [] };
    }

    // 1) Non-archived group memberships — drives the filter dropdown and
    // is the eligible set for matches/practices.
    const groupsRes = await supabase
      .from("group_members")
      .select(
        `group_id, archived_at,
         group:groups!group_members_group_id_fkey ( id, name )`
      )
      .eq("user_id", me)
      .is("archived_at", null);
    if (groupsRes.error) throw groupsRes.error;
    type GroupRow = {
      group_id: string;
      group: { id: string; name: string } | null;
    };
    const userGroupRows = (groupsRes.data ?? []) as unknown as GroupRow[];
    const userGroupIds = userGroupRows.map((r) => r.group_id);
    const userGroups: GroupOption[] = userGroupRows
      .filter((r): r is GroupRow & { group: { id: string; name: string } } => r.group !== null)
      .map((r) => ({ id: r.group.id, name: r.group.name }));

    // Honor the dropdown only if the chosen group is in the user's
    // non-archived list — otherwise treat as no filter.
    const groupFilterId =
      selectedGroup !== "all" && userGroupIds.includes(selectedGroup)
        ? selectedGroup
        : null;
    const teamGroupFilter = groupFilterId ? [groupFilterId] : userGroupIds;

    // 2) Find-players posts I'm involved in: posts I authored + posts I
    // have an approved play_request for. PostgREST doesn't support
    // OR-across-subqueries cleanly, so fan out and merge.
    const [authoredRes, approvedRes] = await Promise.all([
      supabase
        .from("posts")
        .select(
          `id, play_date, play_time, play_duration, court_location,
           game_type, players_needed, players_confirmed, court_booked,
           is_complete, content, author_id,
           author:profiles!posts_author_id_fkey ( id, name, profile_image_url ),
           post_targets ( groups ( id, name ) )`
        )
        .eq("post_type", "find_players")
        .eq("author_id", me),
      supabase
        .from("play_requests")
        .select(
          `status,
           post:posts!play_requests_post_id_fkey (
             id, play_date, play_time, play_duration, court_location,
             game_type, players_needed, players_confirmed, court_booked,
             is_complete, content, author_id, post_type,
             author:profiles!posts_author_id_fkey ( id, name, profile_image_url ),
             post_targets ( groups ( id, name ) )
           )`
        )
        .eq("user_id", me)
        .eq("status", "approved"),
    ]);
    if (authoredRes.error) throw authoredRes.error;
    if (approvedRes.error) throw approvedRes.error;

    type PostRow = {
      id: string;
      play_date: string;
      play_time: string;
      play_duration: number;
      court_location: string;
      game_type: string;
      players_needed: number;
      players_confirmed: number;
      court_booked: boolean;
      is_complete: boolean;
      content: string;
      author_id: string;
      post_type?: string;
      author: { id: string; name: string; profile_image_url: string } | null;
      post_targets: Array<{ groups: { id: string; name: string } | null }> | null;
    };

    const adaptPost = (p: PostRow, role: "creator" | "player"): CalendarEvent => ({
      id: p.id,
      playDate: p.play_date,
      playTime: p.play_time,
      playDuration: p.play_duration,
      courtLocation: p.court_location,
      gameType: p.game_type,
      playersNeeded: p.players_needed,
      playersConfirmed: p.players_confirmed,
      courtBooked: p.court_booked,
      isComplete: p.is_complete,
      content: p.content,
      role,
      author: {
        id: p.author?.id ?? "",
        name: p.author?.name ?? "",
        profileImageUrl: p.author?.profile_image_url ?? "",
      },
      groups: (p.post_targets ?? [])
        .map((pt) => pt.groups)
        .filter((g): g is { id: string; name: string } => g !== null),
    });

    const seenIds = new Set<string>();
    const events: CalendarEvent[] = [];
    for (const p of (authoredRes.data ?? []) as unknown as PostRow[]) {
      seenIds.add(p.id);
      events.push(adaptPost(p, "creator"));
    }
    for (const row of (approvedRes.data ?? []) as unknown as Array<{ post: PostRow | null }>) {
      const p = row.post;
      if (!p || p.post_type !== "find_players") continue;
      if (seenIds.has(p.id)) continue;
      seenIds.add(p.id);
      events.push(adaptPost(p, "player"));
    }
    // Honor the group filter against the joined post_targets list.
    const filteredEvents = groupFilterId
      ? events.filter((e) => e.groups.some((g) => g.id === groupFilterId))
      : events;

    // 3) Team matches — for the eligible team set. Embed availabilities
    // so we can surface my own lineupSlot. (The embed alias is
    // `availabilities`, same as src/app/groups/[id]/calendar/page.tsx —
    // PostgREST resolves it via the match_availabilities → team_matches FK.)
    const matchesRes = teamGroupFilter.length
      ? await supabase
          .from("team_matches")
          .select(
            `id, group_id, match_date, match_time, location, notes,
             group:groups!team_matches_group_id_fkey ( id, name ),
             availabilities ( user_id, lineup_slot )`
          )
          .in("group_id", teamGroupFilter)
          .order("match_date", { ascending: true })
          .order("match_time", { ascending: true })
      : { data: [], error: null };
    if (matchesRes.error) throw matchesRes.error;

    type MatchRow = {
      id: string;
      group_id: string;
      match_date: string;
      match_time: string;
      location: string;
      notes: string;
      group: { id: string; name: string } | null;
      availabilities: Array<{ user_id: string; lineup_slot: string }>;
    };
    const matches: TeamMatchEvent[] = ((matchesRes.data ?? []) as unknown as MatchRow[]).map(
      (m) => {
        const mine = m.availabilities.find((a) => a.user_id === me);
        const slot = (mine?.lineup_slot ?? "").trim();
        return {
          id: m.id,
          teamId: m.group_id,
          teamName: m.group?.name ?? "",
          matchDate: m.match_date,
          matchTime: m.match_time,
          location: m.location,
          notes: m.notes,
          inLineup: slot !== "",
          lineupSlot: slot,
        };
      }
    );

    // 4) Practices I'm "playing" — start from team_practices (typed) and
    // embed availabilities filtered to my own row, plus the series→group
    // chain we need for naming + filter scope.
    const practicesRes = teamGroupFilter.length
      ? await supabase
          .from("team_practices")
          .select(
            `id, practice_date,
             series:practice_series!team_practices_series_id_fkey (
               id, name, location, practice_time, notes, group_id,
               group:groups!practice_series_group_id_fkey ( id, name )
             ),
             availabilities!inner ( user_id, status )`
          )
          .eq("availabilities.user_id", me)
          .eq("availabilities.status", "playing")
      : { data: [], error: null };
    if (practicesRes.error) throw practicesRes.error;

    type PracticeRow = {
      id: string;
      practice_date: string;
      series: {
        id: string;
        name: string;
        location: string;
        practice_time: string;
        notes: string;
        group_id: string;
        group: { id: string; name: string } | null;
      } | null;
    };
    const practices: TeamPracticeEvent[] = ((practicesRes.data ?? []) as unknown as PracticeRow[])
      .map((p) => {
        const s = p.series;
        if (!s) return null;
        if (!teamGroupFilter.includes(s.group_id)) return null;
        return {
          id: p.id,
          teamId: s.group_id,
          teamName: s.group?.name ?? "",
          seriesId: s.id,
          seriesName: s.name,
          practiceDate: p.practice_date,
          practiceTime: s.practice_time,
          location: s.location,
          notes: s.notes,
        } satisfies TeamPracticeEvent;
      })
      .filter((p): p is TeamPracticeEvent => p !== null)
      .sort((a, b) =>
        (a.practiceDate + a.practiceTime).localeCompare(b.practiceDate + b.practiceTime)
      );

    return { events: filteredEvents, matches, practices, userGroups };
  });

  const events = bundle.data?.events ?? [];
  const matches = bundle.data?.matches ?? [];
  const practices = bundle.data?.practices ?? [];
  const groups = bundle.data?.userGroups ?? [];

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

  const matchesByDate = new Map<string, TeamMatchEvent[]>();
  matches.forEach((m) => {
    const d = parseDate(m.matchDate);
    if (!d) return;
    const key = dateKey(d);
    if (!matchesByDate.has(key)) matchesByDate.set(key, []);
    matchesByDate.get(key)!.push(m);
  });

  const practicesByDate = new Map<string, TeamPracticeEvent[]>();
  practices.forEach((p) => {
    const d = parseDate(p.practiceDate);
    if (!d) return;
    const key = dateKey(d);
    if (!practicesByDate.has(key)) practicesByDate.set(key, []);
    practicesByDate.get(key)!.push(p);
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
  const selectedMatches = selectedDate ? (matchesByDate.get(selectedDate) || []) : [];
  const selectedPractices = selectedDate ? (practicesByDate.get(selectedDate) || []) : [];
  const selectedTotal =
    selectedEvents.length + selectedMatches.length + selectedPractices.length;

  // Today and future events only, sorted for list view
  const sortedEvents = events
    .filter((ev) => ev.playDate >= today)
    .sort((a, b) => a.playDate.localeCompare(b.playDate) || a.playTime.localeCompare(b.playTime));
  const sortedMatches = matches
    .filter((m) => m.matchDate >= today)
    .sort((a, b) =>
      a.matchDate.localeCompare(b.matchDate) || (a.matchTime || "").localeCompare(b.matchTime || "")
    );
  const sortedPractices = practices
    .filter((p) => p.practiceDate >= today)
    .sort((a, b) =>
      a.practiceDate.localeCompare(b.practiceDate) ||
      (a.practiceTime || "").localeCompare(b.practiceTime || "")
    );
  const sortedTotal = sortedEvents.length + sortedMatches.length + sortedPractices.length;

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
                const dayMatches = matchesByDate.get(key) || [];
                const dayPractices = practicesByDate.get(key) || [];
                const isToday = key === today;
                const isSelected = key === selectedDate;
                const hasComplete = dayEvents.some((e) => e.isComplete);
                const hasOpen = dayEvents.some((e) => !e.isComplete);
                const hasMatch = dayMatches.length > 0;
                const hasPractice = dayPractices.length > 0;

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
                    {(dayEvents.length > 0 || hasMatch || hasPractice) && (
                      <div className="flex items-center gap-0.5 mt-1">
                        {hasOpen && <div className="w-1.5 h-1.5 rounded-full bg-ball-yellow" />}
                        {hasComplete && <div className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                        {hasMatch && <div className="w-1.5 h-1.5 rounded-full bg-court-green" />}
                        {hasPractice && <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <div className="w-2 h-2 rounded-full bg-ball-yellow" /> Open Game
              </span>
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <div className="w-2 h-2 rounded-full bg-green-500" /> Confirmed
              </span>
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <div className="w-2 h-2 rounded-full bg-court-green" /> Team Match
              </span>
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <div className="w-2 h-2 rounded-full bg-blue-500" /> Team Practice
              </span>
            </div>
          </div>

          {/* Selected date events */}
          {selectedDate && (
            <div className="mt-5 space-y-3 animate-fade-in-up">
              <h3 className="text-sm font-bold text-gray-700">
                {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </h3>
              {selectedTotal === 0 ? (
                <p className="text-sm text-gray-400 bg-white rounded-xl p-4 shadow-sm border border-court-green-pale/20">No games on this day.</p>
              ) : (
                <>
                  {selectedMatches.map((m) => <TeamMatchCard key={`m-${m.id}`} match={m} />)}
                  {selectedPractices.map((p) => <TeamPracticeCard key={`p-${p.id}`} practice={p} />)}
                  {selectedEvents.map((ev) => <EventCard key={ev.id} event={ev} />)}
                </>
              )}
            </div>
          )}
        </>
      ) : (
        /* List view */
        <div className="space-y-3 animate-fade-in-up stagger-2">
          {sortedTotal === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-court-green-pale/20">
              <div className="w-14 h-14 bg-ball-yellow/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-court-green-soft" strokeLinecap="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <h3 className="font-display text-lg font-bold text-gray-800 mb-2">Nothing scheduled yet</h3>
              <p className="text-gray-500 text-sm">Create a &quot;Find Players&quot; post or join a team to see events here.</p>
            </div>
          ) : (
            <>
              {sortedMatches.map((m) => <TeamMatchCard key={`m-${m.id}`} match={m} />)}
              {sortedPractices.map((p) => <TeamPracticeCard key={`p-${p.id}`} practice={p} />)}
              {sortedEvents.map((ev) => <EventCard key={ev.id} event={ev} />)}
            </>
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

function parseDateLocal(dateStr: string): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

function StarIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className={className} aria-label="You're in">
      <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
    </svg>
  );
}

function TeamMatchCard({ match }: { match: TeamMatchEvent }) {
  return (
    <Link
      href={`/groups/${match.teamId}/availability?focus=${match.id}`}
      className="block bg-white rounded-xl shadow-sm border border-court-green-pale/30 p-4 card-hover"
    >
      <div className="flex items-start gap-3">
        <div className="w-14 shrink-0 rounded-xl text-center py-2 bg-court-green/10">
          <p className="text-[10px] font-bold text-gray-400 uppercase">
            {parseDateLocal(match.matchDate)?.toLocaleDateString("en-US", { month: "short" })}
          </p>
          <p className="text-xl font-bold text-gray-800">
            {parseDateLocal(match.matchDate)?.getDate()}
          </p>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide bg-court-green text-white inline-flex items-center gap-1">
              {match.inLineup && <StarIcon />}
              Match
            </span>
            {match.inLineup && match.lineupSlot && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-court-green-pale/40 text-court-green">
                {match.lineupSlot}
              </span>
            )}
            <span className="text-xs font-semibold text-gray-800 truncate">{match.teamName}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500 mb-1">
            {match.matchTime && (
              <span className="flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" /></svg>
                {match.matchTime}
              </span>
            )}
            <span className="flex items-center gap-1 truncate">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
              {match.location}
            </span>
          </div>
          {match.notes && (
            <p className="text-[11px] text-gray-400 italic truncate">{match.notes}</p>
          )}
        </div>
      </div>
    </Link>
  );
}

function TeamPracticeCard({ practice }: { practice: TeamPracticeEvent }) {
  return (
    <Link
      href={`/groups/${practice.teamId}/practice?focus=${practice.id}`}
      className="block bg-white rounded-xl shadow-sm border border-blue-200 p-4 card-hover"
    >
      <div className="flex items-start gap-3">
        <div className="w-14 shrink-0 rounded-xl text-center py-2 bg-blue-50">
          <p className="text-[10px] font-bold text-gray-400 uppercase">
            {parseDateLocal(practice.practiceDate)?.toLocaleDateString("en-US", { month: "short" })}
          </p>
          <p className="text-xl font-bold text-gray-800">
            {parseDateLocal(practice.practiceDate)?.getDate()}
          </p>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide bg-blue-500 text-white inline-flex items-center gap-1">
              <StarIcon />
              Practice
            </span>
            <span className="text-xs font-semibold text-gray-800 truncate">{practice.seriesName}</span>
            <span className="text-[10px] text-gray-400">· {practice.teamName}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500 mb-1">
            {practice.practiceTime && (
              <span className="flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" /></svg>
                {practice.practiceTime}
              </span>
            )}
            <span className="flex items-center gap-1 truncate">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
              {practice.location}
            </span>
          </div>
          {practice.notes && (
            <p className="text-[11px] text-gray-400 italic truncate">{practice.notes}</p>
          )}
        </div>
      </div>
    </Link>
  );
}
