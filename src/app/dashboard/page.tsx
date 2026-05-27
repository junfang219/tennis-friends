"use client";

import Link from "next/link";
import Avatar from "@/components/Avatar";
import { normalizeMatchStatus, normalizePracticeStatus, RSVP, RSVP_LABEL, type RsvpStatus } from "@/lib/rsvpStatus";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getDashboardUpcoming } from "@/lib/supabase/queries";
import { useCachedQuery } from "@/lib/useCachedQuery";

type Team = { id: string; name: string; imageUrl: string };

type DashMatch = {
  id: string;
  groupId: string;
  group: Team;
  matchDate: string;
  matchTime: string;
  location: string;
  opponent: string;
  homeAway: string;
  myRsvp: string | null;
};

type DashPractice = {
  id: string;
  seriesId: string;
  group: Team;
  seriesName: string;
  practiceDate: string;
  practiceTime: string;
  location: string;
  myRsvp: string | null;
};

type DashAnnouncement = {
  id: string;
  content: string;
  createdAt: string;
  sender: { id: string; name: string; profileImageUrl: string };
  group: Team;
  unread: boolean;
};

type DashboardData = {
  matches: DashMatch[];
  practices: DashPractice[];
  announcements: DashAnnouncement[];
};

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00`);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function rsvpChip(status: RsvpStatus): { label: string; bg: string; text: string } {
  switch (status) {
    case "playing": return { label: RSVP_LABEL.playing, bg: "bg-court-green", text: "text-white" };
    case "maybe": return { label: RSVP_LABEL.maybe, bg: "bg-ball-yellow", text: "text-court-green" };
    case "not_playing": return { label: RSVP_LABEL.not_playing, bg: "bg-gray-200", text: "text-gray-600" };
    default: return { label: "No RSVP", bg: "bg-amber-100", text: "text-amber-700" };
  }
}

export default function DashboardPage() {
  const dashboardQuery = useCachedQuery<DashboardData>("dashboard:upcoming", async () => {
    const supabase = createSupabaseBrowserClient();
    const u = await getDashboardUpcoming(supabase);
    return {
      matches: u.teamMatches.map((m) => ({
        id: m.id,
        groupId: m.group_id,
        group: { id: m.group.id, name: m.group.name, imageUrl: "" },
        matchDate: m.match_date,
        matchTime: m.match_time,
        location: m.location,
        opponent: m.opponent,
        homeAway: "",
        myRsvp: null,
      })),
      practices: [],
      announcements: [],
    };
  });
  const data = dashboardQuery.data ?? null;
  const loading = dashboardQuery.isLoading;
  const err = dashboardQuery.error
    ? dashboardQuery.error.message || "Failed to load dashboard."
    : "";

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="skeleton w-48 h-8 rounded-xl" />
        <div className="skeleton w-full h-32 rounded-2xl" />
        <div className="skeleton w-full h-32 rounded-2xl" />
      </div>
    );
  }
  if (err || !data) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-500">{err || "No dashboard data."}</p>
      </div>
    );
  }

  const hasAny =
    data.matches.length > 0 || data.practices.length > 0 || data.announcements.length > 0;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="mb-4">
        <h1 className="font-display text-2xl font-bold text-gray-900">Your dashboard</h1>
        <p className="text-xs text-gray-500">Everything across your teams in the next 30 days</p>
      </div>

      {!hasAny && (
        <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-gray-100">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-court-green-pale/30 flex items-center justify-center text-2xl">🏖️</div>
          <p className="text-sm font-semibold text-gray-700">Quiet calendar</p>
          <p className="text-xs text-gray-400 mt-1">
            Nothing scheduled across your teams. Head to a team to add a match or practice.
          </p>
        </div>
      )}

      {/* Announcements you haven't seen */}
      {data.announcements.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Recent announcements</h2>
          <div className="space-y-2">
            {data.announcements.slice(0, 5).map((a) => (
              <Link
                key={a.id}
                href={`/groups/${a.group.id}/chat`}
                className={`block p-3 rounded-2xl border transition-colors ${
                  a.unread
                    ? "bg-court-green-pale/15 border-court-green-pale/60"
                    : "bg-white border-gray-100 hover:border-gray-200"
                }`}
              >
                <div className="flex items-start gap-3">
                  <Avatar name={a.sender.name} image={a.sender.profileImageUrl} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-gray-800 truncate">{a.sender.name}</span>
                      <span className="text-[10px] text-gray-400">·</span>
                      <span className="text-[10px] font-semibold text-court-green truncate">{a.group.name}</span>
                      {a.unread && (
                        <span className="ml-auto w-2 h-2 rounded-full bg-court-green shrink-0" aria-label="Unread" />
                      )}
                    </div>
                    <p className="text-sm text-gray-700 mt-1 line-clamp-2 whitespace-pre-wrap">{a.content}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Upcoming matches */}
      {data.matches.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Upcoming matches</h2>
          <div className="space-y-2">
            {data.matches.map((m) => {
              const status = normalizeMatchStatus(m.myRsvp ?? "");
              const chip = rsvpChip(status === RSVP.NO_RESPONSE ? RSVP.NO_RESPONSE : status);
              return (
                <Link
                  key={m.id}
                  href={`/groups/${m.groupId}/availability?focus=${m.id}`}
                  className="flex items-center gap-3 p-3 rounded-2xl border border-gray-100 bg-white hover:border-gray-200 transition-colors"
                >
                  <div className="text-center shrink-0 w-12">
                    <p className="text-[9px] font-bold text-gray-400 uppercase">{new Date(`${m.matchDate}T00:00`).toLocaleDateString("en-US", { month: "short" })}</p>
                    <p className="text-lg font-bold text-court-green leading-none">{new Date(`${m.matchDate}T00:00`).getDate()}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {m.opponent ? `vs ${m.opponent}` : "Team match"}
                    </p>
                    <p className="text-[11px] text-gray-500 truncate">
                      {m.group.name}{m.matchTime ? ` · ${m.matchTime}` : ""}
                      {m.homeAway ? ` · ${m.homeAway}` : ""}
                    </p>
                    <p className="text-[10px] text-gray-400 truncate">📍 {m.location}</p>
                  </div>
                  <span className={`shrink-0 ${chip.bg} ${chip.text} text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider`}>
                    {chip.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Upcoming practices */}
      {data.practices.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Upcoming practices</h2>
          <div className="space-y-2">
            {data.practices.map((p) => {
              const status = normalizePracticeStatus(p.myRsvp ?? "");
              const chip = rsvpChip(status === RSVP.NO_RESPONSE ? RSVP.NO_RESPONSE : status);
              return (
                <Link
                  key={p.id}
                  href={`/groups/${p.group.id}/practice?focus=${p.id}`}
                  className="flex items-center gap-3 p-3 rounded-2xl border border-gray-100 bg-white hover:border-gray-200 transition-colors"
                >
                  <div className="text-center shrink-0 w-12">
                    <p className="text-[9px] font-bold text-gray-400 uppercase">{new Date(`${p.practiceDate}T00:00`).toLocaleDateString("en-US", { month: "short" })}</p>
                    <p className="text-lg font-bold text-court-green leading-none">{new Date(`${p.practiceDate}T00:00`).getDate()}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{p.seriesName}</p>
                    <p className="text-[11px] text-gray-500 truncate">
                      {p.group.name}{p.practiceTime ? ` · ${p.practiceTime}` : ""}
                    </p>
                    <p className="text-[10px] text-gray-400 truncate">📍 {p.location}</p>
                  </div>
                  <span className={`shrink-0 ${chip.bg} ${chip.text} text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider`}>
                    {chip.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <p className="text-center text-[11px] text-gray-400 mt-6">
        Need to RSVP? Tap any item to jump to the team page.
      </p>
    </div>
  );
}
