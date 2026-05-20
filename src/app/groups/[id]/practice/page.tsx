"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import { normalizePracticeStatus } from "@/lib/rsvpStatus";

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
  practiceId: string;
  userId: string;
  status: string;
  user: { id: string; name: string; profileImageUrl: string };
};

type Practice = {
  id: string;
  practiceDate: string;
  availabilities: Availability[];
};

type Series = {
  id: string;
  name: string;
  location: string;
  practiceTime: string;
  notes: string;
  practices: Practice[];
};

const STATUS_OPTIONS: { value: string; label: string; bg: string; text: string }[] = [
  { value: "im_in", label: "I'm in", bg: "bg-court-green", text: "text-white" },
  { value: "not_available", label: "Not avail", bg: "bg-red-100", text: "text-red-600" },
];

function statusMeta(status: string) {
  // Accept both legacy ("im_in", "not_available") and new ("playing", "not_playing")
  // vocab — normalize both sides during the PR #5 transition.
  const target = normalizePracticeStatus(status);
  return STATUS_OPTIONS.find((s) => normalizePracticeStatus(s.value) === target);
}

function formatDateHeader(iso: string) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function TeamPracticePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusPracticeId = searchParams.get("focus");
  const { data: session } = useSession();
  const groupId = params.id as string;
  const myId = session?.user?.id || "";

  const practiceHeaderRefs = useRef<Record<string, HTMLTableCellElement | null>>({});
  const [highlightPracticeId, setHighlightPracticeId] = useState<string | null>(null);

  const [team, setTeam] = useState<Team | null>(null);
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Add-series form
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [practiceDate, setPracticeDate] = useState("");
  const [practiceTime, setPracticeTime] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [repeats, setRepeats] = useState("");
  const [repeatUntil, setRepeatUntil] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  // Status popover (member sets own status)
  const [statusPopover, setStatusPopover] = useState<{
    practiceId: string;
    top: number;
    left: number;
  } | null>(null);

  // Send roster spinner
  const [sendingPracticeId, setSendingPracticeId] = useState<string | null>(null);

  // Inline edit per series
  const [editingSeriesId, setEditingSeriesId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const isCaptain = team ? myId === team.ownerId : false;

  const loadAll = async () => {
    setLoading(true);
    try {
      const [teamRes, seriesRes] = await Promise.all([
        fetch(`/api/groups/${groupId}`),
        fetch(`/api/groups/${groupId}/practices`),
      ]);
      if (!teamRes.ok) {
        setError(teamRes.status === 403 ? "You are not a member of this team." : "Failed to load team.");
        setLoading(false);
        return;
      }
      const teamData = await teamRes.json();
      setTeam(teamData);
      if (seriesRes.ok) {
        const s = await seriesRes.json();
        setSeriesList(Array.isArray(s) ? s : []);
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

  // Scroll to focused practice column when navigated from elsewhere (e.g. calendar)
  useEffect(() => {
    if (!focusPracticeId || loading || seriesList.length === 0) return;
    requestAnimationFrame(() => {
      const el = practiceHeaderRefs.current[focusPracticeId];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        setHighlightPracticeId(focusPracticeId);
        setTimeout(() => setHighlightPracticeId(null), 2400);
      }
    });
  }, [focusPracticeId, loading, seriesList.length]);

  const addSeries = async () => {
    setAddError("");
    if (!name.trim() || !practiceDate || !location.trim() || adding) return;
    if (repeats && !repeatUntil) {
      setAddError("Pick an end date for the repeating practice.");
      return;
    }
    if (repeats && repeatUntil < practiceDate) {
      setAddError("End date must be on or after the start date.");
      return;
    }
    if (repeats === "twice_weekly" && weekdays.length !== 2) {
      setAddError("Pick exactly 2 weekdays for twice-a-week practice.");
      return;
    }
    setAdding(true);
    const res = await fetch(`/api/groups/${groupId}/practices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        practiceDate,
        practiceTime,
        location: location.trim(),
        notes: notes.trim(),
        repeats,
        repeatUntil: repeats ? repeatUntil : undefined,
        weekdays: repeats === "twice_weekly" ? weekdays : undefined,
      }),
    });
    if (res.ok) {
      const newSeries = await res.json();
      setSeriesList((prev) => [...prev, newSeries]);
      setShowAdd(false);
      setName("");
      setPracticeDate("");
      setPracticeTime("");
      setLocation("");
      setNotes("");
      setRepeats("");
      setRepeatUntil("");
      setWeekdays([]);
    } else {
      const data = await res.json().catch(() => ({}));
      setAddError(data.error || "Failed to add practice");
    }
    setAdding(false);
  };

  const toggleWeekday = (day: number) => {
    setWeekdays((prev) => {
      if (prev.includes(day)) return prev.filter((d) => d !== day);
      if (prev.length >= 2) return prev;
      return [...prev, day];
    });
  };

  const startEdit = (series: Series) => {
    setEditingSeriesId(series.id);
    setEditName(series.name);
    setEditLocation(series.location);
    setEditTime(series.practiceTime);
    setEditNotes(series.notes);
  };

  const cancelEdit = () => {
    setEditingSeriesId(null);
  };

  const saveEdit = async (seriesId: string) => {
    if (!editName.trim() || !editLocation.trim() || savingEdit) return;
    setSavingEdit(true);
    const res = await fetch(`/api/groups/${groupId}/practice-series/${seriesId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName.trim(),
        location: editLocation.trim(),
        practiceTime: editTime,
        notes: editNotes.trim(),
      }),
    });
    if (res.ok) {
      const updated = await res.json();
      setSeriesList((prev) => prev.map((s) => (s.id === seriesId ? updated : s)));
      setEditingSeriesId(null);
    }
    setSavingEdit(false);
  };

  const deleteSeries = async (series: Series) => {
    const label = series.practices.length === 1
      ? `Delete "${series.name}"?`
      : `Delete "${series.name}" and all ${series.practices.length} of its practice dates?`;
    if (!confirm(label)) return;
    const res = await fetch(`/api/groups/${groupId}/practice-series/${series.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setSeriesList((prev) => prev.filter((s) => s.id !== series.id));
    }
  };

  const deletePractice = async (seriesId: string, practiceId: string) => {
    if (!confirm("Delete this date? Member availability for it will be removed.")) return;
    const res = await fetch(`/api/groups/${groupId}/practices/${practiceId}`, { method: "DELETE" });
    if (res.ok) {
      setSeriesList((prev) =>
        prev.map((s) =>
          s.id === seriesId
            ? { ...s, practices: s.practices.filter((p) => p.id !== practiceId) }
            : s
        )
      );
    }
  };

  const setMyAvailability = async (seriesId: string, practiceId: string, status: string) => {
    const res = await fetch(`/api/groups/${groupId}/practices/${practiceId}/availability`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const upserted = await res.json();
      setSeriesList((prev) =>
        prev.map((s) => {
          if (s.id !== seriesId) return s;
          return {
            ...s,
            practices: s.practices.map((p) => {
              if (p.id !== practiceId) return p;
              const others = p.availabilities.filter((a) => a.userId !== myId);
              return { ...p, availabilities: [...others, upserted] };
            }),
          };
        })
      );
    }
  };

  const sendPractice = async (series: Series, practice: Practice) => {
    const inPlayers = practice.availabilities
      .filter((a) => a.status === "im_in" || a.status === "playing")
      .map((a) => a.user.name)
      .sort((x, y) => x.localeCompare(y));

    if (inPlayers.length === 0) {
      alert("No one has marked themselves \"I'm in\" yet.");
      return;
    }

    const header = `🎾 ${series.name} — ${formatDateHeader(practice.practiceDate)}${
      series.practiceTime ? ` at ${series.practiceTime}` : ""
    }\n📍 ${series.location}${series.notes ? `\n📝 ${series.notes}` : ""}\n\n`;
    const roster = `I'm in (${inPlayers.length}):\n${inPlayers.map((n) => `• ${n}`).join("\n")}`;
    const content = header + roster;

    setSendingPracticeId(practice.id);
    const res = await fetch(`/api/groups/${groupId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (res.ok) {
      router.push(`/groups/${groupId}/chat`);
      return;
    }
    const data = await res.json().catch(() => ({}));
    alert(data.error || "Failed to send to team chat");
    setSendingPracticeId(null);
  };

  const getAvail = (practice: Practice, userId: string) =>
    practice.availabilities.find((a) => a.userId === userId);

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
          <p className="text-xs text-gray-500">Team Practice</p>
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
            Add Practice
          </button>
        )}
      </div>

      {/* Add practice form (captain only) */}
      {showAdd && isCaptain && (
        <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-5 mb-5 animate-fade-in-up">
          <h3 className="font-display text-base font-bold text-gray-800 mb-4">New Practice</h3>
          <div className="mb-3">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Spring Drills, Tuesday Hits"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Start date</label>
              <input
                type="date"
                value={practiceDate}
                onChange={(e) => setPracticeDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Time (optional)</label>
              <input
                type="time"
                lang="en-GB"
                value={practiceTime}
                onChange={(e) => setPracticeTime(e.target.value)}
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
            <label className="block text-xs font-semibold text-gray-600 mb-1">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Bring extra balls"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
            />
          </div>
          <div className="mb-3">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Repeats</label>
            <select
              value={repeats}
              onChange={(e) => {
                setRepeats(e.target.value);
                if (!e.target.value) {
                  setRepeatUntil("");
                  setWeekdays([]);
                } else if (e.target.value !== "twice_weekly") {
                  setWeekdays([]);
                }
              }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white appearance-none"
            >
              <option value="">One-time</option>
              <option value="weekly">Once a week</option>
              <option value="twice_weekly">Twice a week</option>
              <option value="biweekly">Every other week</option>
              <option value="monthly">Once a month</option>
            </select>
          </div>
          {repeats === "twice_weekly" && (
            <div className="mb-3">
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Weekdays <span className="font-normal text-gray-400">(pick 2)</span>
              </label>
              <div className="flex gap-1.5">
                {["S", "M", "T", "W", "T", "F", "S"].map((label, i) => {
                  const active = weekdays.includes(i);
                  const disabled = !active && weekdays.length >= 2;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleWeekday(i)}
                      disabled={disabled}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${
                        active
                          ? "bg-court-green text-white"
                          : disabled
                          ? "bg-gray-50 text-gray-300 cursor-not-allowed"
                          : "bg-gray-100 text-gray-600 hover:bg-court-green-pale/40 hover:text-court-green"
                      }`}
                      aria-pressed={active}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                Practices fall on every selected weekday in the date range. The start date snaps forward to the first match if it doesn&apos;t fall on one of these.
              </p>
            </div>
          )}
          {repeats && (
            <div className="mb-3">
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Repeat until <span className="font-normal text-gray-400">(end date, inclusive)</span>
              </label>
              <input
                type="date"
                value={repeatUntil}
                min={practiceDate || undefined}
                onChange={(e) => setRepeatUntil(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
              />
            </div>
          )}
          {addError && (
            <p className="text-xs text-red-500 mb-2">{addError}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={addSeries}
              disabled={
                !name.trim() ||
                !practiceDate ||
                !location.trim() ||
                adding ||
                (!!repeats && !repeatUntil) ||
                (repeats === "twice_weekly" && weekdays.length !== 2)
              }
              className="btn-primary flex-1"
            >
              {adding ? "Adding..." : "Add Practice"}
            </button>
            <button onClick={() => setShowAdd(false)} className="btn-secondary flex-1">Cancel</button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {seriesList.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-court-green-pale/20">
          <div className="w-14 h-14 bg-court-green-pale/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-court-green-soft">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <h3 className="font-display text-lg font-bold text-gray-800 mb-2">No practices scheduled</h3>
          <p className="text-gray-500 text-sm max-w-xs mx-auto">
            {isCaptain
              ? "Add the first practice to start collecting availability from your team."
              : "The captain will add practices soon. Check back later!"}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {seriesList.map((series) => {
            const isEditing = editingSeriesId === series.id;
            return (
              <div
                key={series.id}
                className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 overflow-hidden"
              >
                {/* Series header */}
                <div className="px-4 py-3 bg-court-green-pale/15 border-b border-court-green-pale/30">
                  {isEditing ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Name"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={editLocation}
                          onChange={(e) => setEditLocation(e.target.value)}
                          placeholder="Location"
                          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                        />
                        <input
                          type="time"
                          lang="en-GB"
                          value={editTime}
                          onChange={(e) => setEditTime(e.target.value)}
                          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                        />
                      </div>
                      <input
                        type="text"
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        placeholder="Notes (optional)"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                      />
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => saveEdit(series.id)}
                          disabled={!editName.trim() || !editLocation.trim() || savingEdit}
                          className="btn-primary btn-sm flex-1"
                        >
                          {savingEdit ? "Saving..." : "Save"}
                        </button>
                        <button onClick={cancelEdit} className="btn-secondary btn-sm flex-1">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-display text-base font-bold text-court-green truncate">
                          {series.name}
                        </h3>
                        <div className="text-[11px] text-gray-600 flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                          <span>📍 {series.location}</span>
                          {series.practiceTime && <span>🕒 {series.practiceTime}</span>}
                          <span className="text-gray-400">
                            {series.practices.length} {series.practices.length === 1 ? "date" : "dates"}
                          </span>
                        </div>
                        {series.notes && (
                          <p className="text-[11px] text-gray-500 italic mt-1 truncate">{series.notes}</p>
                        )}
                      </div>
                      {isCaptain && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => startEdit(series)}
                            className="text-[11px] font-semibold text-gray-500 hover:text-court-green px-2 py-1 rounded hover:bg-white"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteSeries(series)}
                            className="text-[11px] font-semibold text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-white"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Series table */}
                {series.practices.length === 0 ? (
                  <div className="p-6 text-center text-sm text-gray-400">
                    All dates have been removed from this series.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="sticky left-0 z-20 bg-gray-50 p-3 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 border-r border-gray-200 min-w-[160px]">
                            Member
                          </th>
                          {series.practices.map((practice) => {
                            const isHighlighted = highlightPracticeId === practice.id;
                            const inCount = practice.availabilities.filter((a) => a.status === "im_in" || a.status === "playing").length;
                            const sending = sendingPracticeId === practice.id;
                            return (
                              <th
                                key={practice.id}
                                ref={(el) => {
                                  practiceHeaderRefs.current[practice.id] = el;
                                }}
                                className={`p-3 text-left min-w-[180px] border-r border-gray-200 transition-colors ${
                                  isHighlighted ? "bg-court-green-pale/30 ring-2 ring-court-green ring-inset" : ""
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="text-xs font-bold text-court-green">{formatDateHeader(practice.practiceDate)}</p>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {isCaptain && (
                                      <button
                                        onClick={() => sendPractice(series, practice)}
                                        disabled={inCount === 0 || sending}
                                        className={`text-[10px] font-semibold px-2 py-1 rounded-md inline-flex items-center gap-1 transition-colors ${
                                          inCount > 0
                                            ? "bg-court-green text-white hover:bg-court-green-light"
                                            : "bg-gray-100 text-gray-400 cursor-not-allowed"
                                        }`}
                                        title={inCount > 0 ? `Send roster of ${inCount} to team chat` : "No one is in yet"}
                                      >
                                        {sending ? (
                                          "..."
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
                                        onClick={() => deletePractice(series.id, practice.id)}
                                        className="text-gray-300 hover:text-red-500"
                                        title="Delete this date"
                                        aria-label="Delete this date"
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
                              {series.practices.map((practice) => {
                                const a = getAvail(practice, m.user.id);
                                const meta = a && a.status ? statusMeta(a.status) : null;
                                const cellKey = `${practice.id}-${m.user.id}`;
                                return (
                                  <td key={cellKey} className="p-3 border-r border-gray-200 align-top min-w-[180px]">
                                    {isMe ? (
                                      <button
                                        onClick={(e) => {
                                          const rect = e.currentTarget.getBoundingClientRect();
                                          setStatusPopover({
                                            practiceId: practice.id,
                                            top: rect.bottom + 4,
                                            left: rect.left,
                                          });
                                        }}
                                        className={`w-full text-left px-2 py-1.5 rounded-lg border ${
                                          meta
                                            ? `${meta.bg} ${meta.text} border-transparent`
                                            : "border-dashed border-gray-300 text-gray-400 hover:border-court-green hover:text-court-green"
                                        } text-xs font-semibold`}
                                      >
                                        {meta?.label || "Set status"}
                                      </button>
                                    ) : (
                                      <div
                                        className={`px-2 py-1.5 rounded-lg text-xs font-semibold ${
                                          meta ? `${meta.bg} ${meta.text}` : "border border-dashed border-gray-200 text-gray-300"
                                        }`}
                                      >
                                        {meta?.label || "—"}
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      {seriesList.length > 0 && (
        <div className="mt-4 flex items-center justify-center gap-3 flex-wrap text-[11px]">
          {STATUS_OPTIONS.map((opt) => (
            <span key={opt.value} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg ${opt.bg} ${opt.text} font-semibold`}>
              {opt.label}
            </span>
          ))}
        </div>
      )}

      {/* Status popover (self, portal) */}
      {statusPopover && typeof document !== "undefined" && (() => {
        const series = seriesList.find((s) => s.practices.some((p) => p.id === statusPopover.practiceId));
        const practice = series?.practices.find((p) => p.id === statusPopover.practiceId);
        const a = practice?.availabilities.find((aa) => aa.userId === myId);
        if (!series || !practice) return null;
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
              <div className="grid grid-cols-2 gap-1">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setMyAvailability(series.id, practice.id, opt.value);
                      setStatusPopover(null);
                    }}
                    className={`text-[10px] font-semibold px-2 py-1.5 rounded ${
                      normalizePracticeStatus(a?.status || "") === normalizePracticeStatus(opt.value)
                        ? `${opt.bg} ${opt.text} ring-2 ring-court-green/40`
                        : `${opt.bg} ${opt.text} opacity-70 hover:opacity-100`
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
    </div>
  );
}
