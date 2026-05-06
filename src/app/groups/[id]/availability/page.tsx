"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import Avatar from "@/components/Avatar";

type Member = {
  id: string;
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
  notes: string;
  availabilities: Availability[];
};

const STATUS_OPTIONS: { value: string; label: string; bg: string; text: string }[] = [
  { value: "available", label: "Available", bg: "bg-court-green", text: "text-white" },
  { value: "if_needed", label: "If needed", bg: "bg-ball-yellow", text: "text-court-green" },
  { value: "not_available", label: "Not avail", bg: "bg-red-100", text: "text-red-600" },
  { value: "not_sure", label: "Not sure", bg: "bg-gray-200", text: "text-gray-600" },
];

const TYPE_OPTIONS: { value: string; label: string; chip: string }[] = [
  { value: "singles", label: "Singles", chip: "S" },
  { value: "doubles", label: "Doubles", chip: "D" },
  { value: "both", label: "Both", chip: "S/D" },
];

const SLOT_OPTIONS = ["S1", "S2", "S3", "S4", "D1", "D2", "D3", "D4", "Reserve"];

const SLOT_ORDER: Record<string, number> = {
  S1: 1, S2: 2, S3: 3, S4: 4,
  D1: 5, D2: 6, D3: 7, D4: 8,
  Reserve: 9,
};

function compareSlots(a: string, b: string) {
  const ao = SLOT_ORDER[a];
  const bo = SLOT_ORDER[b];
  if (ao !== undefined && bo !== undefined) return ao - bo;
  if (ao !== undefined) return -1;
  if (bo !== undefined) return 1;
  return a.localeCompare(b);
}

function statusMeta(status: string) {
  return STATUS_OPTIONS.find((s) => s.value === status);
}

function typeChip(matchTypes: string) {
  const t = TYPE_OPTIONS.find((t) => t.value === matchTypes);
  return t?.chip || "";
}

function formatDateHeader(iso: string) {
  if (!iso) return "";
  // matchDate is "YYYY-MM-DD" — append T00:00 to avoid TZ shifts
  const d = new Date(`${iso}T00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function AvailabilityPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusMatchId = searchParams.get("focus");
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

  // Add-match form
  const [showAdd, setShowAdd] = useState(false);
  const [matchDate, setMatchDate] = useState("");
  const [matchTime, setMatchTime] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [adding, setAdding] = useState(false);

  // Inline editor for self-availability
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);

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

  const isCaptain = team ? myId === team.ownerId : false;

  const loadAll = async () => {
    setLoading(true);
    try {
      const [teamRes, matchesRes] = await Promise.all([
        fetch(`/api/groups/${groupId}`),
        fetch(`/api/groups/${groupId}/matches`),
      ]);
      if (!teamRes.ok) {
        if (teamRes.status === 403) setError("You are not a member of this team.");
        else setError("Failed to load team.");
        setLoading(false);
        return;
      }
      const teamData = await teamRes.json();
      setTeam(teamData);
      if (matchesRes.ok) {
        const m = await matchesRes.json();
        setMatches(Array.isArray(m) ? m : []);
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

  const addMatch = async () => {
    if (!matchDate || !location.trim() || adding) return;
    setAdding(true);
    const res = await fetch(`/api/groups/${groupId}/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchDate, matchTime, location: location.trim(), notes: notes.trim() }),
    });
    if (res.ok) {
      const newMatch = await res.json();
      setMatches((prev) => [...prev, newMatch].sort((a, b) => (a.matchDate + a.matchTime).localeCompare(b.matchDate + b.matchTime)));
      setShowAdd(false);
      setMatchDate("");
      setMatchTime("");
      setLocation("");
      setNotes("");
    }
    setAdding(false);
  };

  const deleteMatch = async (matchId: string) => {
    if (!confirm("Delete this match? Member availability for it will be removed.")) return;
    const res = await fetch(`/api/groups/${groupId}/matches/${matchId}`, { method: "DELETE" });
    if (res.ok) {
      setMatches((prev) => prev.filter((m) => m.id !== matchId));
    }
  };

  const setMyAvailability = async (matchId: string, status: string, matchTypes: string) => {
    const res = await fetch(`/api/groups/${groupId}/matches/${matchId}/availability`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, matchTypes }),
    });
    if (res.ok) {
      const upserted = await res.json();
      setMatches((prev) =>
        prev.map((m) => {
          if (m.id !== matchId) return m;
          const others = m.availabilities.filter((a) => a.userId !== myId);
          return { ...m, availabilities: [...others, upserted] };
        })
      );
    }
  };

  const getAvail = (match: Match, userId: string) =>
    match.availabilities.find((a) => a.userId === userId);

  const setLineupSlot = async (matchId: string, userId: string, slot: string) => {
    const res = await fetch(`/api/groups/${groupId}/matches/${matchId}/lineup`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, lineupSlot: slot }),
    });
    if (res.ok) {
      const upserted: Availability = await res.json();
      setMatches((prev) =>
        prev.map((m) => {
          if (m.id !== matchId) return m;
          const others = m.availabilities.filter((a) => a.userId !== userId);
          return { ...m, availabilities: [...others, upserted] };
        })
      );
    }
  };

  const sendLineup = async (match: Match) => {
    // Group assigned players by slot, in canonical order
    const assigned = match.availabilities.filter((a) => a.lineupSlot && a.lineupSlot.trim());
    if (assigned.length === 0) {
      alert("Assign at least one player to a lineup slot first.");
      return;
    }

    const bySlot = new Map<string, string[]>();
    for (const a of assigned) {
      const slot = a.lineupSlot.trim();
      if (!bySlot.has(slot)) bySlot.set(slot, []);
      bySlot.get(slot)!.push(a.user.name);
    }
    const sortedSlots = Array.from(bySlot.keys()).sort(compareSlots);
    const lineupLines = sortedSlots.map((slot) => `${slot}: ${bySlot.get(slot)!.join(" & ")}`);

    const header = `🎾 Lineup for ${formatDateHeader(match.matchDate)}${match.matchTime ? ` at ${match.matchTime}` : ""}\n📍 ${match.location}\n\n`;
    const content = header + lineupLines.join("\n");

    setSendingLineupId(match.id);
    const res = await fetch(`/api/groups/${groupId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (res.ok) {
      setLineupSentId(match.id);
      setTimeout(() => setLineupSentId(null), 2500);
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to send to team chat");
    }
    setSendingLineupId(null);
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
            onClick={() => setShowAdd(!showAdd)}
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

      {/* Add match form */}
      {showAdd && isCaptain && (
        <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-5 mb-5 animate-fade-in-up">
          <h3 className="font-display text-base font-bold text-gray-800 mb-4">New Match</h3>
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
              onClick={addMatch}
              disabled={!matchDate || !location.trim() || adding}
              className="btn-primary flex-1"
            >
              {adding ? "Adding..." : "Add Match"}
            </button>
            <button onClick={() => setShowAdd(false)} className="btn-secondary flex-1">Cancel</button>
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
                            {match.notes && (
                              <p className="text-[10px] text-gray-400 truncate" title={match.notes}>{match.notes}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {isCaptain && (
                              <button
                                onClick={() => sendLineup(match)}
                                disabled={!hasLineup || sending}
                                className={`text-[10px] font-semibold px-2 py-1 rounded-md inline-flex items-center gap-1 transition-colors ${
                                  justSent
                                    ? "bg-green-100 text-green-700"
                                    : hasLineup
                                    ? "bg-court-green text-white hover:bg-court-green-light"
                                    : "bg-gray-100 text-gray-400 cursor-not-allowed"
                                }`}
                                title="Send lineup to team chat"
                              >
                                {sending ? (
                                  "..."
                                ) : justSent ? (
                                  <>
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="20,6 9,17 4,12" />
                                    </svg>
                                    Sent
                                  </>
                                ) : (
                                  <>
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <line x1="22" y1="2" x2="11" y2="13" />
                                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                                    </svg>
                                    Send
                                  </>
                                )}
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
                        const editing = editingMatchId === match.id && isMe;
                        return (
                          <Fragment key={cellKey}>
                          <td className="p-3 border-r border-gray-100 align-top min-w-[130px]">
                            {isMe ? (
                              <div className="relative">
                                <button
                                  onClick={() => setEditingMatchId(editing ? null : match.id)}
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
                                {editing && (
                                  <>
                                    <div
                                      className="fixed inset-0 z-40"
                                      onClick={() => setEditingMatchId(null)}
                                    />
                                    <div className="absolute left-0 top-full mt-1 z-50 w-44 bg-white rounded-xl shadow-2xl border border-gray-200 p-2">
                                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-1 mb-1">
                                        Status
                                      </p>
                                      <div className="grid grid-cols-2 gap-1 mb-2">
                                        {STATUS_OPTIONS.map((opt) => (
                                          <button
                                            key={opt.value}
                                            onClick={() => {
                                              setMyAvailability(match.id, opt.value, a?.matchTypes || "");
                                            }}
                                            className={`text-[10px] font-semibold px-2 py-1.5 rounded ${
                                              a?.status === opt.value
                                                ? `${opt.bg} ${opt.text} ring-2 ring-court-green/40`
                                                : `${opt.bg} ${opt.text} opacity-70 hover:opacity-100`
                                            }`}
                                          >
                                            {opt.label}
                                          </button>
                                        ))}
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
                                                setMyAvailability(match.id, "available", opt.value);
                                              } else {
                                                setMyAvailability(match.id, a.status, opt.value);
                                              }
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
                                  </>
                                )}
                              </div>
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
                                  setLineupPopover({
                                    matchId: match.id,
                                    userId: m.user.id,
                                    top: rect.bottom + 4,
                                    left: rect.left,
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
          {STATUS_OPTIONS.map((opt) => (
            <span key={opt.value} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg ${opt.bg} ${opt.text} font-semibold`}>
              {opt.label}
            </span>
          ))}
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
                    onClick={() => setLineupSlot(lineupPopover.matchId, lineupPopover.userId, opt)}
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
            <div className="flex items-center gap-1.5 mb-3">
              <input
                type="text"
                value={customSlotInput}
                onChange={(e) => setCustomSlotInput(e.target.value.slice(0, 24))}
                placeholder="e.g. Coach"
                className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-court-green"
              />
              <button
                onClick={() => {
                  if (customSlotInput.trim()) {
                    setLineupSlot(lineupPopover.matchId, lineupPopover.userId, customSlotInput.trim());
                  }
                }}
                disabled={!customSlotInput.trim()}
                className="text-[11px] font-semibold px-2 py-1.5 bg-court-green text-white rounded disabled:opacity-40"
              >
                Set
              </button>
            </div>
            <button
              onClick={() => {
                setLineupSlot(lineupPopover.matchId, lineupPopover.userId, "");
                setCustomSlotInput("");
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
