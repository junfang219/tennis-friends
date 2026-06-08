"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import RsvpPicker, { pickerOptionMeta } from "@/components/attendance/RsvpPicker";
import AttendanceTally from "@/components/attendance/AttendanceTally";
import { normalizeMatchStatus, RSVP } from "@/lib/rsvpStatus";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { fetchGroupBundle, getCachedGroupBundle, sendGroupMessage } from "@/lib/supabase/queries";
import { canCaptain, type TeamRole } from "@/lib/groupRoles";
import { errorMessage } from "@/lib/errorMessage";
import { AvailabilityTabs } from "@/components/availability/AvailabilityTabs";
import SendLineupMenu from "@/components/availability/SendLineupMenu";
import { closePoll } from "@/lib/supabase/queries/availabilityPolls";
import { buildLineupText, formatDateHeader } from "@/lib/lineupMessage";
import { nativeShare } from "@/lib/lfpShare";

type Member = {
  id: string;
  roles: TeamRole[];
  user: { id: string; name: string; profileImageUrl: string; skillLevel: string };
};

type Team = {
  id: string;
  name: string;
  ownerId: string;
  members: Member[];
};

type Availability = {
  id: string;
  matchId: string;
  userId: string;
  status: string;
  matchTypes: string;
  lineupSlot: string;
  user: { id: string; name: string; profileImageUrl: string };
};

type Match = {
  id: string;
  matchDate: string;
  matchTime: string;
  location: string;
  opponent: string;
  opponentTeamId: string | null;
  notes: string;
  availabilities: Availability[];
};

const TYPE_OPTIONS: { value: string; label: string; chip: string }[] = [
  { value: "singles", label: "Singles", chip: "S" },
  { value: "doubles", label: "Doubles", chip: "D" },
  { value: "both", label: "Both", chip: "S/D" },
];

const SLOT_OPTIONS = ["S1", "S2", "S3", "S4", "D1", "D2", "D3", "D4", "Reserve"];

function statusMeta(status: string) {
  // Normalize legacy values (available/if_needed/not_sure/not_available) into
  // the unified vocab so historical rows still render correctly until the
  // legacy normalizer can be removed.
  return pickerOptionMeta(normalizeMatchStatus(status));
}

function typeChip(matchTypes: string) {
  const t = TYPE_OPTIONS.find((t) => t.value === matchTypes);
  return t?.chip || "";
}

export default function AvailabilityPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusMatchId = searchParams.get("focus");
  // Poll → match handoff: when the captain converts a winning poll window
  // into a real match, the poll page navigates here with these query params.
  // We open the Add Match form prefilled, then on successful insert close
  // the source poll and replace the URL so a refresh doesn't re-trigger.
  const prefillDate = searchParams.get("prefillDate");
  const prefillTime = searchParams.get("prefillTime");
  const fromPollIdParam = searchParams.get("fromPollId");
  const fromPollIdRef = useRef<string | null>(fromPollIdParam);
  const { data: session } = useSession();
  const groupId = params.id as string;
  const myId = session?.user?.id || "";

  // Refs for each match column header so we can scroll/highlight when navigated from the calendar
  const matchHeaderRefs = useRef<Record<string, HTMLTableCellElement | null>>({});
  const [highlightMatchId, setHighlightMatchId] = useState<string | null>(null);

  const [team, setTeam] = useState<Team | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Add/edit-match form — editingMatchId null = creating, set = editing that match
  const [showAdd, setShowAdd] = useState(false);
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [matchDate, setMatchDate] = useState("");
  const [matchTime, setMatchTime] = useState("");
  const [location, setLocation] = useState("");
  const [opponent, setOpponent] = useState("");
  const [notes, setNotes] = useState("");
  const [adding, setAdding] = useState(false);
  const matchFormRef = useRef<HTMLDivElement | null>(null);

  // Inline editor for self-availability — portal-anchored to avoid clipping by overflow-x table
  const [statusPopover, setStatusPopover] = useState<{
    matchId: string;
    top: number;
    left: number;
  } | null>(null);

  // Lineup popover (captain only) — opens via portal anchored to clicked cell
  const [lineupPopover, setLineupPopover] = useState<{
    matchId: string;
    userId: string;
    top: number;
    left: number;
  } | null>(null);
  const [customSlotInput, setCustomSlotInput] = useState("");

  // Send Lineup feedback per match
  const [sendingLineupId, setSendingLineupId] = useState<string | null>(null);
  const [lineupSentId, setLineupSentId] = useState<string | null>(null);

  // Captain (OPS) powers: the owner always, plus anyone holding the captain
  // role. Previously this was locked to the owner only.
  const myMember = team?.members.find((m) => m.user.id === myId);
  const isCaptain = !!team && canCaptain({ isOwner: myId === team.ownerId, roles: myMember?.roles ?? [] });

  const toTeam = (
    g: { id: string; name: string; owner_id: string },
    members: { id: string; roles: TeamRole[]; user: { id: string; name: string; profile_image_url: string } }[]
  ) =>
    ({
      id: g.id,
      name: g.name,
      ownerId: g.owner_id,
      members: members.map((m) => ({
        id: m.id,
        roles: m.roles,
        user: {
          id: m.user.id,
          name: m.user.name,
          profileImageUrl: m.user.profile_image_url,
          skillLevel: "",
        },
      })),
    }) as unknown as Team;

  const loadAll = async () => {
    const supabase = createSupabaseBrowserClient();

    // Paint instantly from the cache the team page primed; revalidate below.
    const cached = getCachedGroupBundle(groupId);
    if (cached) {
      setTeam(toTeam(cached.group, cached.members));
      setLoading(false);
    } else {
      setLoading(true);
    }

    try {
      // Team header and matches don't depend on each other — fetch together
      // so the tab opens in one round-trip instead of two.
      const [bundle, matchRes] = await Promise.all([
        fetchGroupBundle(supabase, groupId),
        supabase
          .from("team_matches")
          .select(
            `id, match_date, match_time, location, opponent, opponent_team_id, notes,
             availabilities ( id, user_id, status, match_types, lineup_slot,
               user:profiles!availabilities_user_id_fkey ( id, name, profile_image_url ) )`
          )
          .eq("group_id", groupId)
          .order("match_date", { ascending: true }),
      ]);
      if (!bundle.group) {
        setError("You are not a member of this team.");
        setLoading(false);
        return;
      }
      setTeam(toTeam(bundle.group, bundle.members));

      const matchRows = matchRes.data;
      type RawAvail = {
        id: string;
        user_id: string;
        status: string;
        match_types: string;
        lineup_slot: string;
        user: { id: string; name: string; profile_image_url: string };
      };
      type Row = {
        id: string;
        match_date: string;
        match_time: string;
        location: string;
        opponent: string;
        opponent_team_id: string | null;
        notes: string;
        availabilities: RawAvail[];
      };
      setMatches(
        ((matchRows ?? []) as unknown as Row[]).map((m) => ({
          id: m.id,
          matchDate: m.match_date,
          matchTime: m.match_time,
          location: m.location,
          opponent: m.opponent,
          opponentTeamId: m.opponent_team_id,
          notes: m.notes,
          availabilities: m.availabilities.map((a) => ({
            id: a.id,
            userId: a.user_id,
            status: a.status,
            matchTypes: a.match_types,
            lineupSlot: a.lineup_slot,
            user: {
              id: a.user.id,
              name: a.user.name,
              profileImageUrl: a.user.profile_image_url,
            },
          })),
        })) as unknown as Match[]
      );
    } catch {
      setError("Something went wrong.");
    }
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // Seed the Add Match form from a poll → match handoff (?prefillDate=&prefillTime=).
  // Runs once on mount; clears the params from the URL so a refresh won't re-open the form.
  useEffect(() => {
    if (prefillDate || prefillTime) {
      setShowAdd(true);
      if (prefillDate) setMatchDate(prefillDate);
      if (prefillTime) setMatchTime(prefillTime);
      const next = new URLSearchParams();
      if (focusMatchId) next.set("focus", focusMatchId);
      const qs = next.toString();
      router.replace(`/groups/${groupId}/availability${qs ? `?${qs}` : ""}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll to and highlight the focused match column when navigated from elsewhere (e.g. calendar)
  useEffect(() => {
    if (!focusMatchId || loading || matches.length === 0) return;
    requestAnimationFrame(() => {
      const el = matchHeaderRefs.current[focusMatchId];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        setHighlightMatchId(focusMatchId);
        setTimeout(() => setHighlightMatchId(null), 2400);
      }
    });
  }, [focusMatchId, loading, matches.length]);

  const resetMatchForm = () => {
    setShowAdd(false);
    setEditingMatchId(null);
    setMatchDate("");
    setMatchTime("");
    setLocation("");
    setOpponent("");
    setNotes("");
  };

  // Open the form prefilled with an existing match (captain only).
  // Location and time often change after posting, so matches stay editable.
  const startEditMatch = (match: Match) => {
    setEditingMatchId(match.id);
    setMatchDate(match.matchDate);
    setMatchTime(match.matchTime);
    setLocation(match.location);
    setOpponent(match.opponent);
    setNotes(match.notes);
    setShowAdd(true);
    // The form renders above the table; bring it into view since the
    // edited column may be scrolled far right/down.
    requestAnimationFrame(() => {
      matchFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const saveMatch = async () => {
    if (!matchDate || !location.trim() || adding) return;
    setAdding(true);
    const supabase = createSupabaseBrowserClient();
    const fields = {
      match_date: matchDate,
      match_time: matchTime,
      location: location.trim(),
      opponent: opponent.trim(),
      notes: notes.trim(),
      // Tag the row with the user's local IANA zone so the
      // event-reminders cron can compute the reminder window in
      // their local time instead of Vercel-UTC.
      timezone:
        (typeof Intl !== "undefined" &&
          Intl.DateTimeFormat().resolvedOptions().timeZone) ||
        "America/Los_Angeles",
    };
    if (editingMatchId) {
      const { data, error: updErr } = await supabase
        .from("team_matches")
        .update(fields)
        .eq("id", editingMatchId)
        .select("id, match_date, match_time, location, opponent, notes")
        .single();
      if (!updErr && data) {
        setMatches((prev) =>
          prev
            .map((m) =>
              m.id === data.id
                ? {
                    ...m,
                    matchDate: data.match_date,
                    matchTime: data.match_time,
                    location: data.location,
                    opponent: data.opponent,
                    notes: data.notes,
                  }
                : m
            )
            .sort((a, b) => (a.matchDate + a.matchTime).localeCompare(b.matchDate + b.matchTime))
        );
        resetMatchForm();
      }
      setAdding(false);
      return;
    }
    const { data, error: insErr } = await supabase
      .from("team_matches")
      .insert({ group_id: groupId, ...fields })
      .select("id, match_date, match_time, location, opponent, notes")
      .single();
    if (!insErr && data) {
      const newMatch: Match = {
        id: data.id,
        matchDate: data.match_date,
        matchTime: data.match_time,
        location: data.location,
        opponent: data.opponent,
        opponentTeamId: null,
        notes: data.notes,
        availabilities: [],
      } as unknown as Match;
      setMatches((prev) => [...prev, newMatch].sort((a, b) => (a.matchDate + a.matchTime).localeCompare(b.matchDate + b.matchTime)));
      // Close the source poll and link it to this new match. RLS already
      // limits captains-only UPDATE so we don't need to gate this on isCaptain.
      if (fromPollIdRef.current) {
        try {
          await closePoll(supabase, { pollId: fromPollIdRef.current, resultingMatchId: data.id });
        } catch { /* non-fatal */ }
        fromPollIdRef.current = null;
      }
      resetMatchForm();
    }
    setAdding(false);
  };

  const deleteMatch = async (matchId: string) => {
    if (!confirm("Delete this match? Member availability for it will be removed.")) return;
    const supabase = createSupabaseBrowserClient();
    const { error: delErr } = await supabase.from("team_matches").delete().eq("id", matchId);
    if (!delErr) {
      setMatches((prev) => prev.filter((m) => m.id !== matchId));
    }
  };

  const setMyAvailability = async (matchId: string, status: string, matchTypes: string) => {
    const supabase = createSupabaseBrowserClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { data, error: upErr } = await supabase
      .from("availabilities")
      .upsert(
        {
          event_kind: "match",
          match_id: matchId,
          user_id: auth.user.id,
          status,
          match_types: matchTypes,
        },
        { onConflict: "match_id,user_id" }
      )
      .select(
        `id, user_id, status, match_types, lineup_slot,
         user:profiles!availabilities_user_id_fkey ( id, name, profile_image_url )`
      )
      .single();
    if (!upErr && data) {
      const a = data as unknown as {
        id: string;
        user_id: string;
        status: string;
        match_types: string;
        lineup_slot: string;
        user: { id: string; name: string; profile_image_url: string };
      };
      const upserted = {
        id: a.id,
        userId: a.user_id,
        status: a.status,
        matchTypes: a.match_types,
        lineupSlot: a.lineup_slot,
        user: {
          id: a.user.id,
          name: a.user.name,
          profileImageUrl: a.user.profile_image_url,
        },
      };
      setMatches((prev) =>
        prev.map((m) => {
          if (m.id !== matchId) return m;
          const others = m.availabilities.filter((a2) => a2.userId !== myId);
          return { ...m, availabilities: [...others, upserted] as Availability[] };
        })
      );
    }
  };

  const getAvail = (match: Match, userId: string) =>
    match.availabilities.find((a) => a.userId === userId);

  const setLineupSlot = async (matchId: string, userId: string, slot: string) => {
    const supabase = createSupabaseBrowserClient();
    const { data, error: upErr } = await supabase
      .from("availabilities")
      .upsert(
        {
          event_kind: "match",
          match_id: matchId,
          user_id: userId,
          lineup_slot: slot,
        },
        { onConflict: "match_id,user_id" }
      )
      .select(
        `id, user_id, status, match_types, lineup_slot,
         user:profiles!availabilities_user_id_fkey ( id, name, profile_image_url )`
      )
      .single();
    if (upErr) {
      alert(errorMessage(upErr, "Failed to set lineup slot"));
      return;
    }
    if (data) {
      const a = data as unknown as {
        id: string;
        user_id: string;
        status: string;
        match_types: string;
        lineup_slot: string;
        user: { id: string; name: string; profile_image_url: string };
      };
      const upserted: Availability = {
        id: a.id,
        userId: a.user_id,
        status: a.status,
        matchTypes: a.match_types,
        lineupSlot: a.lineup_slot,
        user: {
          id: a.user.id,
          name: a.user.name,
          profileImageUrl: a.user.profile_image_url,
        },
      } as Availability;
      setMatches((prev) =>
        prev.map((m) => {
          if (m.id !== matchId) return m;
          const others = m.availabilities.filter((av) => av.userId !== userId);
          return { ...m, availabilities: [...others, upserted] };
        })
      );
    }
  };

  const noLineupAssigned = () => alert("Assign at least one player to a lineup slot first.");

  // Destination 1: post the lineup into the in-app team chat.
  const postLineupToChat = async (match: Match) => {
    const content = buildLineupText(match);
    if (!content) {
      noLineupAssigned();
      return;
    }

    setSendingLineupId(match.id);
    try {
      const supabase = createSupabaseBrowserClient();
      await sendGroupMessage(supabase, groupId, content);
      router.push(`/groups/${groupId}/chat`);
    } catch (err) {
      alert(errorMessage(err, "Failed to send to team chat"));
      setSendingLineupId(null);
    }
  };

  // Destination 2: hand the same text to the native iOS share sheet (Messages /
  // iMessage). title/url are intentionally empty so nativeShare omits them and
  // Messages sends plain text instead of a link card.
  const shareLineupViaMessages = async (match: Match) => {
    const content = buildLineupText(match);
    if (!content) {
      noLineupAssigned();
      return;
    }
    const res = await nativeShare({ title: "", text: content, url: "" }, "lineupShare");
    if (res.outcome === "failed") {
      alert(res.error || "Couldn't open Messages.");
      return;
    }
    if (res.outcome === "shared" || res.outcome === "copied") {
      // Brief confirmation — unlike the chat path, this one stays on the page.
      setLineupSentId(match.id);
      setTimeout(() => setLineupSentId((id) => (id === match.id ? null : id)), 2500);
    }
  };

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-500">{error}</p>
        <button onClick={() => router.back()} className="btn-primary mt-4">Go Back</button>
      </div>
    );
  }

  if (loading || !team) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="skeleton w-48 h-8 mb-4" />
        <div className="skeleton w-full h-64" />
      </div>
    );
  }

  const sortedMembers = [...team.members].sort((a, b) => {
    if (a.user.id === team.ownerId) return -1;
    if (b.user.id === team.ownerId) return 1;
    return a.user.name.localeCompare(b.user.name);
  });

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <Link
          href={`/groups/${groupId}`}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15,18 9,12 15,6" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-xl font-bold text-court-green truncate">{team.name}</h1>
          <p className="text-xs text-gray-500">Match Availability</p>
        </div>
        {isCaptain && (
          <button
            onClick={() => {
              if (showAdd) {
                resetMatchForm();
              } else {
                // A previous edit may have left prefilled values behind.
                setEditingMatchId(null);
                setMatchDate("");
                setMatchTime("");
                setLocation("");
                setOpponent("");
                setNotes("");
                setShowAdd(true);
              }
            }}
            className="btn-primary btn-sm inline-flex"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Match
          </button>
        )}
      </div>

      <AvailabilityTabs groupId={groupId} active="matches" />

      {/* Add match form */}
      {showAdd && isCaptain && (
        <div ref={matchFormRef} className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-5 mb-5 animate-fade-in-up">
          <h3 className="font-display text-base font-bold text-gray-800 mb-4">{editingMatchId ? "Edit Match" : "New Match"}</h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Date</label>
              <input
                type="date"
                value={matchDate}
                onChange={(e) => setMatchDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Time (optional)</label>
              <input
                type="time"
                lang="en-GB"
                value={matchTime}
                onChange={(e) => setMatchTime(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
              />
            </div>
          </div>
          <div className="mb-3">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Location</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Court 3, Riverside Park"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
            />
          </div>
          <div className="mb-3">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Opponent Team (optional)</label>
            <input
              type="text"
              value={opponent}
              onChange={(e) => setOpponent(e.target.value)}
              placeholder="e.g. Greenlake Smashers"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
            />
          </div>
          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Bring extra balls"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={saveMatch}
              disabled={!matchDate || !location.trim() || adding}
              className="btn-primary flex-1"
            >
              {editingMatchId ? (adding ? "Saving..." : "Save") : adding ? "Adding..." : "Add Match"}
            </button>
            <button onClick={resetMatchForm} className="btn-secondary flex-1">Cancel</button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {matches.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-court-green-pale/20">
          <div className="w-14 h-14 bg-court-green-pale/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-court-green-soft">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <h3 className="font-display text-lg font-bold text-gray-800 mb-2">No matches scheduled</h3>
          <p className="text-gray-500 text-sm max-w-xs mx-auto">
            {isCaptain
              ? "Add the first match to start collecting availability from your team."
              : "The captain will add matches soon. Check back later!"}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th rowSpan={2} className="sticky left-0 z-20 bg-gray-50 p-3 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 border-r border-gray-200 min-w-[160px]">
                    Member
                  </th>
                  {matches.map((match) => {
                    const hasLineup = match.availabilities.some((a) => a.lineupSlot && a.lineupSlot.trim());
                    const sending = sendingLineupId === match.id;
                    const justSent = lineupSentId === match.id;
                    const isHighlighted = highlightMatchId === match.id;
                    return (
                      <th
                        key={match.id}
                        colSpan={2}
                        ref={(el) => {
                          matchHeaderRefs.current[match.id] = el;
                        }}
                        className={`p-3 text-left min-w-[260px] border-r border-gray-200 transition-colors ${
                          isHighlighted ? "bg-court-green-pale/30 ring-2 ring-court-green ring-inset" : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-court-green">{formatDateHeader(match.matchDate)}</p>
                            {match.matchTime && (
                              <p className="text-[10px] text-gray-500">{match.matchTime}</p>
                            )}
                            <p className="text-[11px] text-gray-700 font-medium truncate" title={match.location}>
                              📍 {match.location}
                            </p>
                            {match.opponent && (
                              <p className="text-[11px] text-gray-700 font-medium truncate" title={match.opponent}>
                                🆚 {match.opponent}
                              </p>
                            )}
                            {match.opponentTeamId && (
                              <Link
                                href={`/groups/${groupId}/scouting`}
                                className="text-[11px] text-court-green font-medium hover:underline"
                              >
                                🔎 Scout opponent
                              </Link>
                            )}
                            {match.notes && (
                              <p className="text-[10px] text-gray-400 truncate" title={match.notes}>{match.notes}</p>
                            )}
                            <AttendanceTally availabilities={match.availabilities} />
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {isCaptain && (
                              <SendLineupMenu
                                hasLineup={hasLineup}
                                sending={sending}
                                justSent={justSent}
                                onPostToChat={() => postLineupToChat(match)}
                                onSendViaMessages={() => shareLineupViaMessages(match)}
                              />
                            )}
                            {isCaptain && (
                              <button
                                onClick={() => startEditMatch(match)}
                                className="text-gray-300 hover:text-court-green"
                                title="Edit match"
                                aria-label="Edit match"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                </svg>
                              </button>
                            )}
                            {isCaptain && (
                              <button
                                onClick={() => deleteMatch(match.id)}
                                className="text-gray-300 hover:text-red-500"
                                title="Delete match"
                                aria-label="Delete match"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                  <line x1="18" y1="6" x2="6" y2="18" />
                                  <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                      </th>
                    );
                  })}
                </tr>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {matches.map((match) => (
                    <Fragment key={match.id}>
                      <th className="text-[10px] uppercase tracking-wider text-gray-400 font-bold px-3 py-1.5 text-left border-r border-gray-100 min-w-[130px]">
                        Avail
                      </th>
                      <th className="text-[10px] uppercase tracking-wider text-gray-400 font-bold px-3 py-1.5 text-left border-r border-gray-200 min-w-[130px]">
                        Lineup
                      </th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedMembers.map((m) => {
                  const isMe = m.user.id === myId;
                  const isCapRow = m.user.id === team.ownerId;
                  return (
                    <tr key={m.id} className="border-b border-gray-100 last:border-b-0">
                      <td className="sticky left-0 z-10 bg-white p-3 border-r border-gray-200">
                        <div className="flex items-center gap-2">
                          <div className="relative shrink-0">
                            <Avatar name={m.user.name} image={m.user.profileImageUrl} size="sm" />
                            {isCapRow && (
                              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-ball-yellow flex items-center justify-center ring-2 ring-white shadow-sm">
                                <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" className="text-court-green">
                                  <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                                </svg>
                              </span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-gray-900 truncate">
                              {m.user.name}{isMe ? " (you)" : ""}
                            </p>
                            {isCapRow && (
                              <p className="text-[9px] font-bold tracking-wider text-court-green">CAPTAIN</p>
                            )}
                          </div>
                        </div>
                      </td>
                      {matches.map((match) => {
                        const a = getAvail(match, m.user.id);
                        const meta = a && a.status ? statusMeta(a.status) : null;
                        const cellKey = `${match.id}-${m.user.id}`;
                        return (
                          <Fragment key={cellKey}>
                          <td className="p-3 border-r border-gray-100 align-top min-w-[130px]">
                            {isMe ? (
                              <button
                                onClick={(e) => {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  // Status popover is w-44 (176px). Clamp so it
                                  // doesn't overflow the right edge on mobile
                                  // when the anchor cell is far right.
                                  const popW = 176;
                                  const maxLeft = window.innerWidth - popW - 8;
                                  setStatusPopover({
                                    matchId: match.id,
                                    top: rect.bottom + 4,
                                    left: Math.max(8, Math.min(rect.left, maxLeft)),
                                  });
                                }}
                                className={`w-full text-left px-2 py-1.5 rounded-lg border ${
                                  meta
                                    ? `${meta.bg} ${meta.text} border-transparent`
                                    : "border-dashed border-gray-300 text-gray-400 hover:border-court-green hover:text-court-green"
                                } text-xs font-semibold flex items-center justify-between gap-1`}
                              >
                                <span className="truncate">{meta?.label || "Set status"}</span>
                                {a?.matchTypes && (
                                  <span className="text-[9px] font-bold bg-white/30 px-1 rounded">
                                    {typeChip(a.matchTypes)}
                                  </span>
                                )}
                              </button>
                            ) : (
                              <div
                                className={`px-2 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-between gap-1 ${
                                  meta ? `${meta.bg} ${meta.text}` : "border border-dashed border-gray-200 text-gray-300"
                                }`}
                              >
                                <span className="truncate">{meta?.label || "—"}</span>
                                {a?.matchTypes && (
                                  <span className="text-[9px] font-bold bg-white/30 px-1 rounded">
                                    {typeChip(a.matchTypes)}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="p-3 border-r border-gray-200 align-top min-w-[130px]">
                            {isCaptain ? (
                              <button
                                onClick={(e) => {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  // Lineup popover is w-60 (240px). Clamp left
                                  // so it doesn't overflow the viewport when
                                  // the anchor cell is on the right side.
                                  const popW = 240;
                                  const maxLeft = window.innerWidth - popW - 8;
                                  setLineupPopover({
                                    matchId: match.id,
                                    userId: m.user.id,
                                    top: rect.bottom + 4,
                                    left: Math.max(8, Math.min(rect.left, maxLeft)),
                                  });
                                  setCustomSlotInput(a?.lineupSlot || "");
                                }}
                                className={`w-full text-left px-2 py-1.5 rounded-lg border text-xs font-semibold ${
                                  a?.lineupSlot
                                    ? "bg-court-green-pale/40 text-court-green border-court-green-pale"
                                    : "border-dashed border-gray-300 text-gray-400 hover:border-court-green hover:text-court-green"
                                }`}
                              >
                                {a?.lineupSlot || "Assign"}
                              </button>
                            ) : (
                              <div
                                className={`px-2 py-1.5 rounded-lg text-xs font-semibold ${
                                  a?.lineupSlot
                                    ? "bg-court-green-pale/40 text-court-green border border-court-green-pale"
                                    : "border border-dashed border-gray-200 text-gray-300"
                                }`}
                              >
                                {a?.lineupSlot || "—"}
                              </div>
                            )}
                          </td>
                          </Fragment>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Legend */}
      {matches.length > 0 && (
        <div className="mt-4 flex items-center justify-center gap-3 flex-wrap text-[11px]">
          {[RSVP.PLAYING, RSVP.MAYBE, RSVP.NOT_PLAYING].map((s) => {
            const meta = pickerOptionMeta(s);
            if (!meta) return null;
            return (
              <span key={s} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg ${meta.bg} ${meta.text} font-semibold`}>
                {meta.label}
              </span>
            );
          })}
          <span className="text-gray-400 mx-1">·</span>
          {TYPE_OPTIONS.map((opt) => (
            <span key={opt.value} className="inline-flex items-center gap-1 text-gray-500">
              <span className="text-[9px] font-bold bg-gray-200 text-gray-700 px-1 rounded">{opt.chip}</span>
              {opt.label}
            </span>
          ))}
          {isCaptain && (
            <span className="text-gray-400 italic">· Tap any Lineup cell to assign a slot.</span>
          )}
        </div>
      )}

      {/* Status popover (self, portal) — escapes the table's overflow clipping */}
      {statusPopover && typeof document !== "undefined" && (() => {
        const m = matches.find((mm) => mm.id === statusPopover.matchId);
        const a = m?.availabilities.find((aa) => aa.userId === myId);
        return createPortal(
          <>
            <div className="fixed inset-0 z-[998]" onClick={() => setStatusPopover(null)} />
            <div
              className="fixed z-[999] w-44 bg-white rounded-xl shadow-2xl border border-gray-200 p-2"
              style={{ top: statusPopover.top, left: statusPopover.left }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-1 mb-1">
                Status
              </p>
              <div className="mb-2">
                <RsvpPicker
                  value={normalizeMatchStatus(a?.status || "")}
                  onSelect={(status) => {
                    setMyAvailability(statusPopover.matchId, status, a?.matchTypes || "");
                    setStatusPopover(null);
                  }}
                />
              </div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-1 mb-1">
                Match type
              </p>
              <div className="grid grid-cols-3 gap-1">
                {TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      if (!a?.status) {
                        setMyAvailability(statusPopover.matchId, RSVP.PLAYING, opt.value);
                      } else {
                        setMyAvailability(statusPopover.matchId, a.status, opt.value);
                      }
                      setStatusPopover(null);
                    }}
                    className={`text-[10px] font-semibold px-2 py-1.5 rounded border ${
                      a?.matchTypes === opt.value
                        ? "border-court-green bg-court-green text-white"
                        : "border-gray-200 text-gray-600 hover:border-court-green-pale"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </>,
          document.body
        );
      })()}

      {/* Lineup popover (captain only, portal) */}
      {lineupPopover && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-[998]" onClick={() => setLineupPopover(null)} />
          <div
            className="fixed z-[999] w-60 bg-white rounded-xl shadow-2xl border border-gray-200 p-3"
            style={{ top: lineupPopover.top, left: lineupPopover.left }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Slot</p>
            <div className="grid grid-cols-3 gap-1 mb-3">
              {SLOT_OPTIONS.map((opt) => {
                const current = (() => {
                  const m = matches.find((mm) => mm.id === lineupPopover.matchId);
                  if (!m) return "";
                  const a = m.availabilities.find((aa) => aa.userId === lineupPopover.userId);
                  return a?.lineupSlot || "";
                })();
                const active = current === opt;
                return (
                  <button
                    key={opt}
                    onClick={() => {
                      setLineupSlot(lineupPopover.matchId, lineupPopover.userId, opt);
                      setLineupPopover(null);
                    }}
                    className={`text-[11px] font-semibold px-2 py-1.5 rounded ${
                      active
                        ? "bg-court-green text-white ring-2 ring-court-green/40"
                        : "bg-gray-100 text-gray-700 hover:bg-court-green-pale/50 hover:text-court-green"
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Custom</p>
            <div className="space-y-1.5 mb-3">
              <input
                type="text"
                value={customSlotInput}
                onChange={(e) => setCustomSlotInput(e.target.value.slice(0, 24))}
                placeholder="e.g. Coach"
                className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-court-green"
              />
              <button
                onClick={() => {
                  if (customSlotInput.trim()) {
                    setLineupSlot(lineupPopover.matchId, lineupPopover.userId, customSlotInput.trim());
                    setLineupPopover(null);
                  }
                }}
                disabled={!customSlotInput.trim()}
                className="w-full text-[11px] font-semibold px-2 py-1.5 bg-court-green text-white rounded disabled:opacity-40"
              >
                Set
              </button>
            </div>
            <button
              onClick={() => {
                setLineupSlot(lineupPopover.matchId, lineupPopover.userId, "");
                setCustomSlotInput("");
                setLineupPopover(null);
              }}
              className="w-full text-[11px] font-semibold px-2 py-1.5 text-red-500 hover:bg-red-50 rounded border border-red-100"
            >
              Clear slot
            </button>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
