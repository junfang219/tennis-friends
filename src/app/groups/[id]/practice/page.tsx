"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import HScrollFrame from "@/components/HScrollFrame";
import RsvpPicker, { pickerOptionMeta } from "@/components/attendance/RsvpPicker";
import AttendanceTally from "@/components/attendance/AttendanceTally";
import { normalizePracticeStatus } from "@/lib/rsvpStatus";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { fetchGroupBundle, getCachedGroupBundle, sendGroupMessage } from "@/lib/supabase/queries";
import { canCaptain, type TeamRole } from "@/lib/groupRoles";
import { errorMessage } from "@/lib/errorMessage";
import InvitePlayersPanel from "@/components/groups/InvitePlayersPanel";

type Member = {
  id: string;
  roles: TeamRole[];
  isPlaceholder: boolean;
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
  memberId: string; // keys the cell to a roster row (real or placeholder)
  userId: string | null; // null for placeholder RSVPs
  status: string;
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

function statusMeta(status: string) {
  // Normalize legacy values (im_in/not_available) into the unified vocab so
  // historical rows still render correctly.
  return pickerOptionMeta(normalizePracticeStatus(status));
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
  const [showInvite, setShowInvite] = useState(false);
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
  // userId is normally the current user, but a captain can open it on any
  // member's row to edit on their behalf.
  const [statusPopover, setStatusPopover] = useState<{
    practiceId: string;
    memberId: string;
    userId: string | null;
    top: number;
    left: number;
  } | null>(null);

  // Send roster spinner
  const [sendingPracticeId, setSendingPracticeId] = useState<string | null>(null);

  // Narrow-screen view shows one practice date at a time per series; this maps
  // each series id to its selected practice id.
  const [activePracticeId, setActivePracticeId] = useState<Record<string, string>>({});

  // Inline edit per series
  const [editingSeriesId, setEditingSeriesId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Captain (OPS) powers: the owner always, plus anyone holding the captain
  // role. Previously this was locked to the owner only.
  const myMember = team?.members.find((m) => !m.isPlaceholder && m.user.id === myId);
  const isCaptain = !!team && canCaptain({ isOwner: myId === team.ownerId, roles: myMember?.roles ?? [] });

  const toTeam = (
    g: { id: string; name: string; owner_id: string },
    members: {
      id: string;
      roles: TeamRole[];
      isPlaceholder: boolean;
      user: { id: string; name: string; profile_image_url: string };
    }[]
  ) =>
    ({
      id: g.id,
      name: g.name,
      ownerId: g.owner_id,
      members: members.map((m) => ({
        id: m.id,
        roles: m.roles,
        isPlaceholder: m.isPlaceholder,
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
      // Team header and practice series are independent — one round-trip.
      const [bundle, seriesRes] = await Promise.all([
        fetchGroupBundle(supabase, groupId),
        supabase
          .from("practice_series")
          .select(
            `id, name, location, practice_time, notes,
             team_practices ( id, practice_date,
               availabilities ( id, member_id, user_id, status )
             )`
          )
          .eq("group_id", groupId)
          .order("created_at", { ascending: false }),
      ]);
      if (!bundle.group) {
        setError("You are not a member of this team.");
        setLoading(false);
        return;
      }
      setTeam(toTeam(bundle.group, bundle.members));

      const seriesRows = seriesRes.data;
      type RawSeries = {
        id: string;
        name: string;
        location: string;
        practice_time: string;
        notes: string;
        team_practices: {
          id: string;
          practice_date: string;
          availabilities: {
            id: string;
            member_id: string;
            user_id: string | null;
            status: string;
          }[];
        }[];
      };
      setSeriesList(
        ((seriesRows ?? []) as unknown as RawSeries[]).map((s) => ({
          id: s.id,
          name: s.name,
          location: s.location,
          practiceTime: s.practice_time,
          notes: s.notes,
          practices: s.team_practices
            .map((p) => ({
              id: p.id,
              practiceDate: p.practice_date,
              availabilities: p.availabilities.map((a) => ({
                id: a.id,
                memberId: a.member_id,
                userId: a.user_id,
                status: a.status,
              })),
            }))
            .sort((x, y) => x.practiceDate.localeCompare(y.practiceDate)),
        })) as unknown as Series[]
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

  // Keep each series' narrow-screen practice selector pointed at a valid date.
  useEffect(() => {
    if (seriesList.length === 0) return;
    setActivePracticeId((cur) => {
      const next = { ...cur };
      let changed = false;
      for (const s of seriesList) {
        const valid = next[s.id] && s.practices.some((p) => p.id === next[s.id]);
        if (!valid && s.practices.length > 0) {
          next[s.id] = s.practices[0].id;
          changed = true;
        }
      }
      return changed ? next : cur;
    });
  }, [seriesList]);

  // Scroll to focused practice column when navigated from elsewhere (e.g. calendar)
  useEffect(() => {
    if (!focusPracticeId || loading || seriesList.length === 0) return;
    // On narrow screens the table is hidden, so selecting the practice in its
    // series is the mobile equivalent of the desktop scroll-into-view below.
    const s = seriesList.find((s) => s.practices.some((p) => p.id === focusPracticeId));
    if (s) setActivePracticeId((cur) => ({ ...cur, [s.id]: focusPracticeId }));
    requestAnimationFrame(() => {
      const el = practiceHeaderRefs.current[focusPracticeId];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        setHighlightPracticeId(focusPracticeId);
        setTimeout(() => setHighlightPracticeId(null), 2400);
      }
    });
    // Intentionally keyed on seriesList.length (not the whole array) so the
    // one-shot scroll/highlight doesn't re-fire on every availability change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    try {
      const supabase = createSupabaseBrowserClient();
      // Insert the parent series.
      const { data: series, error: insErr } = await supabase
        .from("practice_series")
        .insert({
          group_id: groupId,
          name: name.trim(),
          location: location.trim(),
          practice_time: practiceTime,
          notes: notes.trim(),
        })
        .select("id, name, location, practice_time, notes")
        .single();
      if (insErr || !series) throw insErr ?? new Error("Failed");

      // Compute every concrete practice date.
      const dates: string[] = [];
      const start = new Date(`${practiceDate}T00:00:00`);
      if (!repeats) {
        dates.push(practiceDate);
      } else {
        const end = new Date(`${repeatUntil}T00:00:00`);
        const intervalDays = repeats === "weekly" ? 7 : repeats === "biweekly" ? 14 : 7;
        if (repeats === "twice_weekly") {
          for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            if (weekdays.includes(d.getDay())) {
              dates.push(d.toISOString().slice(0, 10));
            }
          }
        } else {
          for (let d = new Date(start); d <= end; d.setDate(d.getDate() + intervalDays)) {
            dates.push(d.toISOString().slice(0, 10));
          }
        }
      }
      // Tag each practice with the user's local IANA zone so the
      // event-reminders cron computes the reminder window correctly
      // (the row's wall-clock practice_time is interpreted in this
      // zone, not Vercel-UTC).
      const tz =
        (typeof Intl !== "undefined" &&
          Intl.DateTimeFormat().resolvedOptions().timeZone) ||
        "America/Los_Angeles";
      const rows = dates.map((d) => ({
        series_id: series.id,
        practice_date: d,
        timezone: tz,
      }));
      await supabase.from("team_practices").insert(rows);

      const newSeries = {
        id: series.id,
        name: series.name,
        location: series.location,
        practiceTime: series.practice_time,
        notes: series.notes,
        practices: dates.map((d, i) => ({ id: `tmp-${i}`, practiceDate: d, availabilities: [] })),
      } as unknown as Series;
      setSeriesList((prev) => [...prev, newSeries]);
      // Refetch to get real practice IDs.
      void loadAll();

      setShowAdd(false);
      setName("");
      setPracticeDate("");
      setPracticeTime("");
      setLocation("");
      setNotes("");
      setRepeats("");
      setRepeatUntil("");
      setWeekdays([]);
    } catch (err) {
      setAddError(errorMessage(err, "Failed to add practice"));
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
    const supabase = createSupabaseBrowserClient();
    const { data, error: upErr } = await supabase
      .from("practice_series")
      .update({
        name: editName.trim(),
        location: editLocation.trim(),
        practice_time: editTime,
        notes: editNotes.trim(),
      })
      .eq("id", seriesId)
      .select("id, name, location, practice_time, notes")
      .single();
    if (!upErr && data) {
      setSeriesList((prev) =>
        prev.map((s) =>
          s.id === seriesId
            ? {
                ...s,
                name: data.name,
                location: data.location,
                practiceTime: data.practice_time,
                notes: data.notes,
              }
            : s
        )
      );
      setEditingSeriesId(null);
    }
    setSavingEdit(false);
  };

  const deleteSeries = async (series: Series) => {
    const label = series.practices.length === 1
      ? `Delete "${series.name}"?`
      : `Delete "${series.name}" and all ${series.practices.length} of its practice dates?`;
    if (!confirm(label)) return;
    const supabase = createSupabaseBrowserClient();
    const { error: delErr } = await supabase.from("practice_series").delete().eq("id", series.id);
    if (!delErr) {
      setSeriesList((prev) => prev.filter((s) => s.id !== series.id));
    }
  };

  const deletePractice = async (seriesId: string, practiceId: string) => {
    if (!confirm("Delete this date? Member availability for it will be removed.")) return;
    const supabase = createSupabaseBrowserClient();
    const { error: delErr } = await supabase.from("team_practices").delete().eq("id", practiceId);
    if (!delErr) {
      setSeriesList((prev) =>
        prev.map((s) =>
          s.id === seriesId
            ? { ...s, practices: s.practices.filter((p) => p.id !== practiceId) }
            : s
        )
      );
    }
  };

  // Upsert practice availability for `userId`. Members may only target their own
  // row; captains may target anyone's (the RLS policy
  // availabilities_update_self_or_captain enforces this server-side too).
  const setAvailability = async (
    seriesId: string,
    practiceId: string,
    memberId: string,
    userId: string | null,
    status: string
  ) => {
    const supabase = createSupabaseBrowserClient();
    const { data, error: upErr } = await supabase
      .from("availabilities")
      .upsert(
        {
          event_kind: "practice",
          practice_id: practiceId,
          member_id: memberId,
          user_id: userId,
          status,
        },
        { onConflict: "practice_id,member_id" }
      )
      .select(`id, member_id, user_id, status`)
      .single();
    if (upErr) {
      alert(errorMessage(upErr, "Failed to set availability"));
      return;
    }
    if (data) {
      const a = data as unknown as {
        id: string;
        member_id: string;
        user_id: string | null;
        status: string;
      };
      const upserted = {
        id: a.id,
        practiceId,
        memberId: a.member_id,
        userId: a.user_id,
        status: a.status,
      };
      setSeriesList((prev) =>
        prev.map((s) => {
          if (s.id !== seriesId) return s;
          return {
            ...s,
            practices: s.practices.map((p) => {
              if (p.id !== practiceId) return p;
              const others = p.availabilities.filter((av) => av.memberId !== memberId);
              return { ...p, availabilities: [...others, upserted] };
            }),
          };
        }) as Series[]
      );
    }
  };

  const sendPractice = async (series: Series, practice: Practice) => {
    const memberName = (memberId: string) =>
      team?.members.find((m) => m.id === memberId)?.user.name ?? "";
    const inPlayers = practice.availabilities
      .filter((a) => a.status === "playing")
      .map((a) => memberName(a.memberId))
      .filter(Boolean)
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
    try {
      const supabase = createSupabaseBrowserClient();
      await sendGroupMessage(supabase, groupId, content);
      router.push(`/groups/${groupId}/chat`);
    } catch (err) {
      alert(errorMessage(err, "Failed to send to team chat"));
      setSendingPracticeId(null);
    }
  };

  const getAvail = (practice: Practice, memberId: string) =>
    practice.availabilities.find((a) => a.memberId === memberId);

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

  // Shared render-helpers so the wide table and the narrow single-date card
  // render identical controls/header from one source of truth.
  const renderPracticeAvailControl = (practice: Practice, m: Member, a: Availability | undefined) => {
    const isMe = !m.isPlaceholder && m.user.id === myId;
    // Members edit only their own availability; captains can edit anyone's.
    const canEdit = isMe || isCaptain;
    const meta = a && a.status ? statusMeta(a.status) : null;
    return canEdit ? (
      <button
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          // Status popover is w-44 (176px). Clamp so it doesn't overflow the
          // right edge when the anchor cell is far right.
          const popW = 176;
          const maxLeft = window.innerWidth - popW - 8;
          setStatusPopover({
            practiceId: practice.id,
            memberId: m.id,
            userId: m.isPlaceholder ? null : m.user.id,
            top: rect.bottom + 4,
            left: Math.max(8, Math.min(rect.left, maxLeft)),
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
    );
  };

  const renderPracticeMeta = (practice: Practice) => (
    <div className="min-w-0">
      <p className="text-xs font-bold text-court-green">{formatDateHeader(practice.practiceDate)}</p>
      <AttendanceTally availabilities={practice.availabilities} />
    </div>
  );

  const renderPracticeActions = (series: Series, practice: Practice) => {
    if (!isCaptain) return null;
    const inCount = practice.availabilities.filter((a) => a.status === "playing").length;
    const sending = sendingPracticeId === practice.id;
    return (
      <div className="flex items-center gap-1 shrink-0">
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
      </div>
    );
  };

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
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowInvite(true)}
              className="btn-secondary btn-sm inline-flex"
              title="Invite players who aren't on TennisFriend yet"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
              Invite
            </button>
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
          </div>
        )}
      </div>

      {/* Invite-players modal (practice-scoped) */}
      {showInvite && isCaptain && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center">
            <div className="fixed inset-0 bg-black/40" onClick={() => setShowInvite(false)} />
            <div className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] overflow-y-auto p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-display text-lg font-bold text-gray-900">Invite players</h2>
                <button
                  onClick={() => setShowInvite(false)}
                  className="p-1 text-gray-400 hover:text-gray-600"
                  aria-label="Close"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <InvitePlayersPanel groupId={groupId} groupName={team.name} onChanged={loadAll} scope="practice" />
            </div>
          </div>,
          document.body
        )}

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
                  <>
                  {/* Wide screens (md+): full members × dates matrix */}
                  <HScrollFrame frameClassName="hidden md:block" className="overflow-x-auto" hint={`Scroll to see all ${series.practices.length} dates`}>
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="sticky left-0 z-20 bg-gray-50 p-3 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 border-r border-gray-200 min-w-[160px]">
                            Member
                          </th>
                          {series.practices.map((practice) => {
                            const isHighlighted = highlightPracticeId === practice.id;
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
                                  {renderPracticeMeta(practice)}
                                  {renderPracticeActions(series, practice)}
                                </div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedMembers.map((m) => {
                          const isMe = !m.isPlaceholder && m.user.id === myId;
                          const isCapRow = !m.isPlaceholder && m.user.id === team.ownerId;
                          return (
                            <tr key={m.id} className="border-b border-gray-100 last:border-b-0">
                              <td className="sticky left-0 z-10 bg-white p-3 border-r border-gray-200">
                                <div className={`flex items-center gap-2 ${m.isPlaceholder ? "opacity-60" : ""}`}>
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
                                    {m.isPlaceholder && (
                                      <p className="text-[9px] font-bold tracking-wider text-gray-400" title="Hasn't created an account yet">NOT JOINED</p>
                                    )}
                                  </div>
                                </div>
                              </td>
                              {series.practices.map((practice) => {
                                const a = getAvail(practice, m.id);
                                const cellKey = `${practice.id}-${m.id}`;
                                return (
                                  <td key={cellKey} className="p-3 border-r border-gray-200 align-top min-w-[180px]">
                                    {renderPracticeAvailControl(practice, m, a)}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </HScrollFrame>

                  {/* Narrow screens: one date at a time (date chips + member list) */}
                  {(() => {
                    const activePractice =
                      series.practices.find((p) => p.id === activePracticeId[series.id]) ?? series.practices[0];
                    return (
                      <div className="md:hidden p-3">
                        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
                          {series.practices.map((practice) => {
                            const active = activePractice?.id === practice.id;
                            return (
                              <button
                                key={practice.id}
                                onClick={() =>
                                  setActivePracticeId((cur) => ({ ...cur, [series.id]: practice.id }))
                                }
                                className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                                  active
                                    ? "bg-court-green text-white"
                                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                }`}
                              >
                                {formatDateHeader(practice.practiceDate)}
                              </button>
                            );
                          })}
                        </div>

                        {activePractice && (
                          <div className="mt-3 rounded-xl border border-gray-100 overflow-hidden">
                            <div className="flex items-start justify-between gap-2 p-3 bg-gray-50 border-b border-gray-100">
                              {renderPracticeMeta(activePractice)}
                              {renderPracticeActions(series, activePractice)}
                            </div>
                            <div className="divide-y divide-gray-100">
                              {sortedMembers.map((m) => {
                                const isMe = !m.isPlaceholder && m.user.id === myId;
                                const isCapRow = !m.isPlaceholder && m.user.id === team.ownerId;
                                const a = getAvail(activePractice, m.id);
                                return (
                                  <div key={m.id} className={`flex items-center gap-2 p-3 ${m.isPlaceholder ? "opacity-60" : ""}`}>
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
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm font-semibold text-gray-900 truncate">
                                        {m.user.name}{isMe ? " (you)" : ""}
                                      </p>
                                      {isCapRow && (
                                        <p className="text-[9px] font-bold tracking-wider text-court-green">CAPTAIN</p>
                                      )}
                                      {m.isPlaceholder && (
                                        <p className="text-[9px] font-bold tracking-wider text-gray-400" title="Hasn't created an account yet">NOT JOINED</p>
                                      )}
                                    </div>
                                    <div className="w-32 shrink-0">
                                      {renderPracticeAvailControl(activePractice, m, a)}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      {seriesList.length > 0 && (
        <div className="mt-4 flex items-center justify-center gap-3 flex-wrap text-[11px]">
          {["playing", "not_playing"].map((s) => {
            const meta = pickerOptionMeta(s);
            if (!meta) return null;
            return (
              <span key={s} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg ${meta.bg} ${meta.text} font-semibold`}>
                {meta.label}
              </span>
            );
          })}
        </div>
      )}

      {/* Status popover (self or, for captains, any member; portal) */}
      {statusPopover && typeof document !== "undefined" && (() => {
        const series = seriesList.find((s) => s.practices.some((p) => p.id === statusPopover.practiceId));
        const practice = series?.practices.find((p) => p.id === statusPopover.practiceId);
        const a = practice?.availabilities.find((aa) => aa.memberId === statusPopover.memberId);
        if (!series || !practice) return null;
        // When a captain edits someone else's row, label the popover with that
        // member's name so it's clear whose status is being changed.
        const targetMember = team.members.find((mm) => mm.id === statusPopover.memberId);
        const editingOther = targetMember?.id !== myMember?.id;
        return createPortal(
          <>
            <div className="fixed inset-0 z-[998]" onClick={() => setStatusPopover(null)} />
            <div
              className="fixed z-[999] w-44 bg-white rounded-xl shadow-2xl border border-gray-200 p-2"
              style={{ top: statusPopover.top, left: statusPopover.left }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-1 mb-1 truncate">
                {editingOther && targetMember ? targetMember.user.name : "Status"}
              </p>
              <RsvpPicker
                value={normalizePracticeStatus(a?.status || "")}
                onSelect={(status) => {
                  setAvailability(series.id, practice.id, statusPopover.memberId, statusPopover.userId, status);
                  setStatusPopover(null);
                }}
                cols={2}
              />
            </div>
          </>,
          document.body
        );
      })()}
    </div>
  );
}
