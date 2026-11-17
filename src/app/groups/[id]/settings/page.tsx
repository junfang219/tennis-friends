"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import Link from "next/link";
import { canAdmin, parseMemberTypes, type TeamRole } from "@/lib/groupRoles";
import { parseReminderPrefs, REMINDER_HOUR_CHOICES, type ReminderPrefs } from "@/lib/reminderPrefs";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getGroup, listGroupMembers } from "@/lib/supabase/queries";
import TeamRoster from "@/components/groups/TeamRoster";
import {
  DIVISION_OPTIONS,
  formatLabel,
  parseLineupFormat,
  type LeagueDivision,
  type LineupSlotDef,
  type RatingScheme,
} from "@/lib/leagueFormats";
import LeagueFields, {
  draftFromSeason,
  draftToColumns,
  emptyLeagueDraft,
  type LeagueDraft,
} from "@/components/groups/LeagueFields";

type Member = {
  id: string;
  userId: string;
  roles: TeamRole[];
  memberType: string;
  isPlaceholder: boolean;
  user: { id: string; name: string; profileImageUrl: string; skillLevel: string };
};

type Group = {
  id: string;
  name: string;
  ownerId: string;
  memberTypes: string[]; // jsonb array from groups.member_types
  reminderPrefs: string; // JSON-encoded { matchHours, practiceHours }
  members: Member[];
};

type Season = {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  // USTA league identity (all optional — casual teams leave these unset).
  division: LeagueDivision | null;
  ratingScheme: RatingScheme | null;
  level: number | null;
  flight: string | null;
  ustaTeamNumber: string | null;
  lineupFormat: LineupSlotDef[] | null;
};

type TabKey = "team" | "roster" | "registration" | "seasons" | "notifications";

const TABS: { key: TabKey; label: string }[] = [
  { key: "team", label: "Team" },
  { key: "roster", label: "Roster" },
  { key: "registration", label: "USTA registration" },
  { key: "seasons", label: "Seasons" },
  { key: "notifications", label: "Notifications" },
];

export default function GroupSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const groupId = params.id as string;

  const [tab, setTab] = useState<TabKey>("team");
  const [group, setGroup] = useState<Group | null>(null);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const userId = session?.user?.id;
  const myRoles = group?.members.find((m) => m.userId === userId)?.roles ?? [];
  const isOwner = !!userId && group?.ownerId === userId;
  const canManage = canAdmin({ isOwner, roles: myRoles });

  const loadGroup = useCallback(async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      const [g, members] = await Promise.all([
        getGroup(supabase, groupId),
        listGroupMembers(supabase, groupId),
      ]);
      if (!g) {
        setError("You are not a member of this team.");
        setLoading(false);
        return;
      }
      setGroup({
        id: g.id,
        name: g.name,
        imageUrl: g.image_url,
        ownerId: g.owner_id,
        memberTypes: Array.isArray(g.member_types) ? (g.member_types as string[]) : [],
        reminderPrefs: g.reminder_prefs,
        members: members.map((m) => ({
          id: m.id,
          userId: m.user_id,
          roles: m.roles,
          memberType: m.member_type,
          isPlaceholder: m.isPlaceholder,
          user: {
            id: m.user.id,
            name: m.user.name,
            profileImageUrl: m.user.profile_image_url,
          },
        })),
      } as unknown as typeof group);
    } catch {
      setError("Failed to load team.");
    }
    setLoading(false);
  }, [groupId]);

  const loadSeasons = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase
      .from("seasons")
      .select(
        "id, name, start_date, end_date, is_active, league_division, rating_scheme, league_level, flight, usta_team_number, lineup_format"
      )
      .eq("group_id", groupId)
      .order("start_date", { ascending: false });
    setSeasons(
      (data ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        startDate: s.start_date,
        endDate: s.end_date,
        isActive: s.is_active,
        division: (s.league_division as LeagueDivision | null) ?? null,
        ratingScheme: (s.rating_scheme as RatingScheme | null) ?? null,
        level: s.league_level,
        flight: s.flight,
        ustaTeamNumber: s.usta_team_number,
        lineupFormat: parseLineupFormat(s.lineup_format),
      }))
    );
  }, [groupId]);

  // Fetch on mount + when groupId changes. The async loaders setState only
  // inside their fetch handlers, but the new React lint flags any setState
  // reachable from an effect body — explicit acknowledgement here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadGroup();
    void loadSeasons();
  }, [loadGroup, loadSeasons]);

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="skeleton w-full h-12 rounded-xl mb-4" />
        <div className="skeleton w-full h-64 rounded-2xl" />
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-500">{error || "Team not found."}</p>
        <Link href="/groups" className="btn-primary mt-4 inline-block">
          Back to Teams
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={() => router.push(`/groups/${groupId}`)}
          className="w-9 h-9 rounded-full bg-white shadow-sm border border-gray-200 hover:bg-gray-50 flex items-center justify-center text-gray-600"
          aria-label="Back to team"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-xl font-bold text-gray-900 truncate">{group.name}</h1>
          <p className="text-xs text-gray-500">Team settings</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-4">
        <div className="flex overflow-x-auto border-b border-gray-100">
          {TABS.filter(t => t.key !== "registration" || (process.env.NEXT_PUBLIC_TEAM_ONBOARDING_ENABLED === "true" && canManage)).map((t) => (
            <button
              key={t.key}
              onClick={() => { if (process.env.NEXT_PUBLIC_TEAM_ONBOARDING_ENABLED === "true" && (t.key === "roster" || t.key === "registration")) router.push(`/groups/${groupId}/${t.key}`); else setTab(t.key); }}
              className={`flex-1 shrink-0 px-3 py-3 text-sm font-semibold transition-colors ${
                tab === t.key
                  ? "text-court-green border-b-2 border-court-green -mb-px"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {tab === "team" && (
            <TeamTab
              group={group}
              canManage={canManage}
              onSaved={loadGroup}
            />
          )}
          {tab === "roster" && (
            <TeamRoster
              group={group}
              canManage={canManage}
              currentUserId={session?.user?.id || ""}
              currentUserName={session?.user?.name || ""}
              onSaved={loadGroup}
            />
          )}
          {tab === "seasons" && (
            <SeasonsTab
              groupId={groupId}
              seasons={seasons}
              canManage={canManage}
              onSaved={loadSeasons}
            />
          )}
          {tab === "notifications" && (
            <NotificationsTab
              group={group}
              canManage={canManage}
              onSaved={loadGroup}
            />
          )}
        </div>
      </div>

      {!canManage && (
        <p className="text-xs text-gray-400 text-center">
          Only team managers can change these settings.
        </p>
      )}
    </div>
  );
}

/* ────── Team tab ────── */

function TeamTab({
  group,
  canManage,
  onSaved,
}: {
  group: Group;
  canManage: boolean;
  onSaved: () => void;
}) {
  // Local edit buffers — initialized from the parent prop and only re-synced
  // when the underlying group identity changes (avoids clobbering in-flight edits
  // when the parent refetches after a save).
  const [name, setName] = useState(group.name);
  const [types, setTypes] = useState<string[]>(parseMemberTypes(group.memberTypes));
  const [newType, setNewType] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [savingTypes, setSavingTypes] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const saveName = async () => {
    if (!name.trim() || name.trim() === group.name) return;
    setSavingName(true);
    setErr("");
    setMsg("");
    const supabase = createSupabaseBrowserClient();
    const { error: upErr } = await supabase
      .from("groups")
      .update({ name: name.trim() })
      .eq("id", group.id);
    if (!upErr) {
      setMsg("Team name updated.");
      onSaved();
    } else {
      setErr(upErr.message || "Failed to save.");
    }
    setSavingName(false);
  };

  const addType = () => {
    const t = newType.trim();
    if (!t || types.includes(t) || types.length >= 16 || t.length > 32) return;
    setTypes([...types, t]);
    setNewType("");
  };

  const removeType = (t: string) => {
    setTypes(types.filter((x) => x !== t));
  };

  const saveTypes = async () => {
    setSavingTypes(true);
    setErr("");
    setMsg("");
    const supabase = createSupabaseBrowserClient();
    const { error: upErr } = await supabase
      .from("groups")
      .update({ member_types: types })
      .eq("id", group.id);
    if (!upErr) {
      setMsg("Member types saved.");
      onSaved();
    } else {
      setErr(upErr.message || "Failed to save.");
    }
    setSavingTypes(false);
  };

  return (
    <div className="space-y-6">
      <section>
        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
          Team name
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canManage}
            className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-court-green disabled:bg-gray-50"
            maxLength={64}
          />
          <button
            onClick={saveName}
            disabled={!canManage || savingName || !name.trim() || name.trim() === group.name}
            className="btn-primary px-4"
          >
            {savingName ? "Saving..." : "Save"}
          </button>
        </div>
      </section>

      <section>
        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
          Member types
        </label>
        <p className="text-xs text-gray-500 mb-3">
          Labels you can assign to each member on the Roster tab. Up to 16, 32 chars each.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {types.length === 0 && (
            <p className="text-xs text-gray-400 italic">No labels yet.</p>
          )}
          {types.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 px-3 py-1 bg-court-green-pale/30 text-court-green text-xs font-semibold rounded-full"
            >
              {t}
              {canManage && (
                <button
                  onClick={() => removeType(t)}
                  className="text-court-green/60 hover:text-court-green"
                  aria-label={`Remove ${t}`}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        {canManage && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addType(); } }}
                placeholder="Add a label (e.g. Sub)"
                maxLength={32}
                className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-court-green"
              />
              <button onClick={addType} className="btn-secondary px-4 shrink-0" disabled={!newType.trim() || types.length >= 16}>
                Add
              </button>
            </div>
            <button onClick={saveTypes} className="btn-primary w-full" disabled={savingTypes}>
              {savingTypes ? "Saving..." : "Save member types"}
            </button>
          </div>
        )}
      </section>

      {msg && <p className="text-xs text-court-green">{msg}</p>}
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}

/* ────── Roster tab ────── */

/* ────── Seasons tab ────── */

function SeasonsTab({
  groupId,
  seasons,
  canManage,
  onSaved,
}: {
  groupId: string;
  seasons: Season[];
  canManage: boolean;
  onSaved: () => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newActive, setNewActive] = useState(true);
  const [newLeague, setNewLeague] = useState<LeagueDraft>(emptyLeagueDraft());
  // Per-season league editor (one open at a time).
  const [editingLeagueId, setEditingLeagueId] = useState("");
  const [editLeague, setEditLeague] = useState<LeagueDraft>(emptyLeagueDraft());
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [err, setErr] = useState("");

  const createSeason = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    setErr("");
    const supabase = createSupabaseBrowserClient();
    if (newActive) {
      // Only one season per group is active at a time.
      await supabase
        .from("seasons")
        .update({ is_active: false })
        .eq("group_id", groupId);
    }
    const { error: insErr } = await supabase.from("seasons").insert({
      group_id: groupId,
      name: newName.trim(),
      start_date: newStart || null,
      end_date: newEnd || null,
      is_active: newActive,
      ...draftToColumns(newLeague),
    });
    if (!insErr) {
      setShowCreate(false);
      setNewName("");
      setNewStart("");
      setNewEnd("");
      setNewActive(true);
      setNewLeague(emptyLeagueDraft());
      onSaved();
    } else {
      setErr(insErr.message || "Failed to create season.");
    }
    setSaving(false);
  };

  const saveLeague = async (seasonId: string) => {
    setBusyId(seasonId);
    setErr("");
    const supabase = createSupabaseBrowserClient();
    const { error: upErr } = await supabase
      .from("seasons")
      .update(draftToColumns(editLeague))
      .eq("id", seasonId);
    if (upErr) {
      setErr(upErr.message || "Failed to save league settings.");
    } else {
      setEditingLeagueId("");
      onSaved();
    }
    setBusyId("");
  };

  const setActive = async (seasonId: string, isActive: boolean) => {
    setBusyId(seasonId);
    setErr("");
    const supabase = createSupabaseBrowserClient();
    if (isActive) {
      await supabase
        .from("seasons")
        .update({ is_active: false })
        .eq("group_id", groupId);
    }
    const { error: upErr } = await supabase
      .from("seasons")
      .update({ is_active: isActive })
      .eq("id", seasonId);
    if (upErr) {
      setErr(upErr.message || "Failed to update season.");
    } else {
      onSaved();
    }
    setBusyId("");
  };

  const removeSeason = async (seasonId: string) => {
    if (!confirm("Delete this season? Matches and practices tagged with it become unscheduled.")) return;
    setBusyId(seasonId);
    setErr("");
    const supabase = createSupabaseBrowserClient();
    const { error: delErr } = await supabase.from("seasons").delete().eq("id", seasonId);
    if (delErr) {
      setErr(delErr.message || "Failed to delete season.");
    } else {
      onSaved();
    }
    setBusyId("");
  };

  const formatRange = (s: Season): string => {
    if (!s.startDate && !s.endDate) return "No dates set";
    const f = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "?");
    return `${f(s.startDate)} → ${f(s.endDate)}`;
  };

  // "Adult 40 & Over · 3.5 · Flight 2 · 1S+3D" — null when no league fields set.
  const leagueSummary = (s: Season): string | null => {
    const parts: string[] = [];
    const div = DIVISION_OPTIONS.find((d) => d.value === s.division)?.label;
    if (div) parts.push(div);
    if (s.level != null) parts.push(s.level.toFixed(1));
    if (s.flight) parts.push(`Flight ${s.flight}`);
    if (s.lineupFormat) parts.push(formatLabel(s.lineupFormat));
    return parts.length > 0 ? parts.join(" · ") : null;
  };

  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">
        Group matches, practices, and events into named spans on your team calendar.
      </p>

      <div className="space-y-2">
        {seasons.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-6">No seasons yet.</p>
        )}
        {seasons.map((s) => (
          <div
            key={s.id}
            className="p-3 rounded-xl border border-gray-100 hover:border-gray-200 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-gray-800 truncate">{s.name}</span>
                  {s.isActive && (
                    <span className="text-[9px] font-bold tracking-wider text-court-green bg-court-green-pale/40 px-1.5 py-0.5 rounded uppercase">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">{formatRange(s)}</p>
                {leagueSummary(s) && (
                  <p className="text-[11px] text-gray-600 mt-0.5 truncate">
                    {leagueSummary(s)}
                    {s.ustaTeamNumber ? ` · #${s.ustaTeamNumber}` : ""}
                  </p>
                )}
              </div>
              {canManage && (
                <>
                  <button
                    onClick={() => {
                      if (editingLeagueId === s.id) {
                        setEditingLeagueId("");
                      } else {
                        setEditingLeagueId(s.id);
                        setEditLeague(draftFromSeason(s));
                      }
                    }}
                    disabled={busyId === s.id}
                    className="text-xs font-semibold text-court-green hover:text-court-green-light"
                  >
                    League
                  </button>
                  {!s.isActive && (
                    <button
                      onClick={() => setActive(s.id, true)}
                      disabled={busyId === s.id}
                      className="text-xs font-semibold text-court-green hover:text-court-green-light"
                    >
                      Activate
                    </button>
                  )}
                  <button
                    onClick={() => removeSeason(s.id)}
                    disabled={busyId === s.id}
                    className="text-xs font-semibold text-red-500 hover:text-red-600"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
            {editingLeagueId === s.id && (
              <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                <LeagueFields draft={editLeague} onChange={setEditLeague} />
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingLeagueId("")}
                    className="btn-secondary flex-1"
                    disabled={busyId === s.id}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => saveLeague(s.id)}
                    className="btn-primary flex-1"
                    disabled={busyId === s.id}
                  >
                    {busyId === s.id ? "Saving..." : "Save league"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {canManage && (
        <div className="mt-4">
          {!showCreate ? (
            <button onClick={() => setShowCreate(true)} className="btn-secondary w-full">
              + New season
            </button>
          ) : (
            <div className="p-3 rounded-xl border border-gray-200 bg-gray-50 space-y-3">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Summer 2026"
                maxLength={64}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-court-green"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={newStart}
                  onChange={(e) => setNewStart(e.target.value)}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                />
                <input
                  type="date"
                  value={newEnd}
                  onChange={(e) => setNewEnd(e.target.value)}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={newActive}
                  onChange={(e) => setNewActive(e.target.checked)}
                  className="w-4 h-4 accent-court-green"
                />
                Set as active season
              </label>
              <LeagueFields draft={newLeague} onChange={setNewLeague} />
              <div className="flex gap-2">
                <button onClick={() => setShowCreate(false)} className="btn-secondary flex-1" disabled={saving}>
                  Cancel
                </button>
                <button onClick={createSeason} className="btn-primary flex-1" disabled={saving || !newName.trim()}>
                  {saving ? "Saving..." : "Create"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {err && <p className="text-xs text-red-600 mt-3">{err}</p>}
    </div>
  );
}

/* ────── Notifications tab ────── */

function hoursLabel(h: number): string {
  if (h >= 24) return `${Math.round(h / 24)}d`;
  return `${h}h`;
}

function NotificationsTab({
  group,
  canManage,
  onSaved,
}: {
  group: Group;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [prefs, setPrefs] = useState<ReminderPrefs>(parseReminderPrefs(group.reminderPrefs));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const toggle = (kind: "match" | "practice", hours: number) => {
    if (!canManage) return;
    setPrefs((cur) => {
      const key = kind === "match" ? "matchHours" : "practiceHours";
      const has = cur[key].includes(hours);
      const next = has ? cur[key].filter((h) => h !== hours) : [...cur[key], hours];
      return { ...cur, [key]: next.sort((a, b) => b - a) };
    });
  };

  const save = async () => {
    setSaving(true);
    setMsg("");
    setErr("");
    const supabase = createSupabaseBrowserClient();
    const { error: upErr } = await supabase
      .from("groups")
      .update({ reminder_prefs: prefs })
      .eq("id", group.id);
    if (!upErr) {
      setMsg("Reminder preferences saved.");
      onSaved();
    } else {
      setErr(upErr.message || "Failed to save.");
    }
    setSaving(false);
  };

  // Legacy fetch-based save (now unreachable; retained for reference only):

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">
        Members who haven&apos;t RSVPed get a push + email at each lead time you select.
        Reminders go out within about 15 minutes of each lead time (never early).
      </p>

      <section>
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
          Match reminders
        </h3>
        <div className="flex flex-wrap gap-2">
          {REMINDER_HOUR_CHOICES.map((h) => {
            const on = prefs.matchHours.includes(h);
            return (
              <button
                key={h}
                onClick={() => toggle("match", h)}
                disabled={!canManage}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors disabled:cursor-not-allowed ${
                  on
                    ? "bg-court-green text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {hoursLabel(h)} before
              </button>
            );
          })}
        </div>
        {prefs.matchHours.length === 0 && (
          <p className="text-[11px] text-gray-400 mt-2">Match reminders disabled.</p>
        )}
      </section>

      <section>
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
          Practice reminders
        </h3>
        <div className="flex flex-wrap gap-2">
          {REMINDER_HOUR_CHOICES.map((h) => {
            const on = prefs.practiceHours.includes(h);
            return (
              <button
                key={h}
                onClick={() => toggle("practice", h)}
                disabled={!canManage}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors disabled:cursor-not-allowed ${
                  on
                    ? "bg-court-green text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {hoursLabel(h)} before
              </button>
            );
          })}
        </div>
        {prefs.practiceHours.length === 0 && (
          <p className="text-[11px] text-gray-400 mt-2">Practice reminders disabled.</p>
        )}
      </section>

      {canManage && (
        <button onClick={save} disabled={saving} className="btn-primary w-full">
          {saving ? "Saving..." : "Save reminder preferences"}
        </button>
      )}

      {msg && <p className="text-xs text-court-green">{msg}</p>}
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}
