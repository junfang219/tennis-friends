"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import { DEFAULT_MEMBER_TYPES, isAtLeast, ROLE } from "@/lib/groupRoles";

type Member = {
  id: string;
  userId: string;
  role: string;
  memberType: string;
  user: { id: string; name: string; profileImageUrl: string; skillLevel: string };
};

type Group = {
  id: string;
  name: string;
  ownerId: string;
  memberTypes: string; // JSON-encoded string[]
  members: Member[];
};

type Season = {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
};

type TabKey = "team" | "roster" | "seasons" | "notifications";

const TABS: { key: TabKey; label: string }[] = [
  { key: "team", label: "Team" },
  { key: "roster", label: "Roster" },
  { key: "seasons", label: "Seasons" },
  { key: "notifications", label: "Notifications" },
];

function parseMemberTypesJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
      return parsed.length > 0 ? parsed : [...DEFAULT_MEMBER_TYPES];
    }
  } catch {
    // fall through
  }
  return [...DEFAULT_MEMBER_TYPES];
}

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
  const myRole = group && userId
    ? group.members.find((m) => m.userId === userId)?.role ?? null
    : null;
  const canManage = !!myRole && isAtLeast(myRole, ROLE.MANAGER);

  const loadGroup = useCallback(async () => {
    const res = await fetch(`/api/groups/${groupId}`);
    if (res.status === 403) {
      setError("You are not a member of this team.");
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setError("Failed to load team.");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setGroup(data);
    setLoading(false);
  }, [groupId]);

  const loadSeasons = useCallback(async () => {
    const res = await fetch(`/api/groups/${groupId}/seasons`);
    if (res.ok) setSeasons(await res.json());
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
        <div className="flex border-b border-gray-100">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-3 text-sm font-semibold transition-colors ${
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
            <RosterTab
              group={group}
              canManage={canManage}
              currentUserId={session?.user?.id || ""}
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
          {tab === "notifications" && <NotificationsTab />}
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
  const [types, setTypes] = useState<string[]>(parseMemberTypesJson(group.memberTypes));
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
    const res = await fetch("/api/groups", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: group.id, name: name.trim() }),
    });
    if (res.ok) {
      setMsg("Team name updated.");
      onSaved();
    } else {
      const d = await res.json().catch(() => ({}));
      setErr(d.error || "Failed to save.");
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
    const res = await fetch("/api/groups", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: group.id, memberTypes: types }),
    });
    if (res.ok) {
      setMsg("Member types saved.");
      onSaved();
    } else {
      const d = await res.json().catch(() => ({}));
      setErr(d.error || "Failed to save.");
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
          <div className="flex gap-2">
            <input
              type="text"
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addType(); } }}
              placeholder="Add a label (e.g. Sub)"
              maxLength={32}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-court-green"
            />
            <button onClick={addType} className="btn-secondary px-4" disabled={!newType.trim() || types.length >= 16}>
              Add
            </button>
            <button onClick={saveTypes} className="btn-primary px-4" disabled={savingTypes}>
              {savingTypes ? "Saving..." : "Save"}
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

function RosterTab({
  group,
  canManage,
  currentUserId,
  onSaved,
}: {
  group: Group;
  canManage: boolean;
  currentUserId: string;
  onSaved: () => void;
}) {
  const types = parseMemberTypesJson(group.memberTypes);
  const callerIsOwner = currentUserId === group.ownerId;
  const [busyId, setBusyId] = useState("");
  const [err, setErr] = useState("");

  const updateMember = async (memberId: string, patch: { role?: string; memberType?: string }) => {
    setBusyId(memberId);
    setErr("");
    const res = await fetch(`/api/groups/${group.id}/members/${memberId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErr(d.error || "Failed to save.");
    } else {
      onSaved();
    }
    setBusyId("");
  };

  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">
        Promote managers and captains, or label members by type.
      </p>
      <div className="divide-y divide-gray-100">
        {group.members.map((m) => {
          const isOwnerRow = m.userId === group.ownerId;
          // Anyone above MEMBER may receive the MANAGER role — but only the
          // OWNER may grant MANAGER (gated server-side, mirrored client-side).
          const roleOptions: { value: string; label: string }[] = [
            { value: ROLE.MEMBER, label: "Member" },
            { value: ROLE.CAPTAIN, label: "Captain" },
            ...(callerIsOwner ? [{ value: ROLE.MANAGER, label: "Manager" }] : []),
          ];

          return (
            <div key={m.id} className="flex items-center gap-3 py-3">
              <Avatar name={m.user.name} image={m.user.profileImageUrl} size="md" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-gray-800 truncate">{m.user.name}</span>
                  {m.userId === currentUserId && (
                    <span className="text-[9px] font-medium text-gray-400">(you)</span>
                  )}
                  {isOwnerRow && (
                    <span className="text-[9px] font-bold tracking-wider text-court-green bg-court-green-pale/40 px-1.5 py-0.5 rounded uppercase">
                      Owner
                    </span>
                  )}
                </div>
                {m.memberType && (
                  <p className="text-[11px] text-gray-500 mt-0.5">{m.memberType}</p>
                )}
              </div>

              {/* Role picker */}
              {!isOwnerRow && canManage ? (
                <select
                  value={m.role}
                  onChange={(e) => updateMember(m.id, { role: e.target.value })}
                  disabled={busyId === m.id}
                  className="text-xs px-2 py-1 border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-court-green"
                >
                  {roleOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                  {/* Show the member's current role even if it's not assignable
                      by the caller (e.g. a CAPTAIN viewing a MANAGER row). */}
                  {!roleOptions.some((o) => o.value === m.role) && (
                    <option value={m.role}>{m.role}</option>
                  )}
                </select>
              ) : (
                <span className="text-[10px] font-semibold text-gray-500 px-2 py-0.5 bg-gray-100 rounded-full uppercase tracking-wider">
                  {isOwnerRow ? "Owner" : m.role.toLowerCase()}
                </span>
              )}

              {/* Member-type picker */}
              {canManage && (
                <select
                  value={m.memberType}
                  onChange={(e) => updateMember(m.id, { memberType: e.target.value })}
                  disabled={busyId === m.id || types.length === 0}
                  className="text-xs px-2 py-1 border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-court-green"
                >
                  <option value="">—</option>
                  {types.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      </div>

      {err && <p className="text-xs text-red-600 mt-3">{err}</p>}
    </div>
  );
}

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
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [err, setErr] = useState("");

  const createSeason = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    setErr("");
    const res = await fetch(`/api/groups/${groupId}/seasons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName.trim(),
        startDate: newStart || null,
        endDate: newEnd || null,
        isActive: newActive,
      }),
    });
    if (res.ok) {
      setShowCreate(false);
      setNewName("");
      setNewStart("");
      setNewEnd("");
      setNewActive(true);
      onSaved();
    } else {
      const d = await res.json().catch(() => ({}));
      setErr(d.error || "Failed to create season.");
    }
    setSaving(false);
  };

  const setActive = async (seasonId: string, isActive: boolean) => {
    setBusyId(seasonId);
    setErr("");
    const res = await fetch(`/api/groups/${groupId}/seasons/${seasonId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErr(d.error || "Failed to update season.");
    } else {
      onSaved();
    }
    setBusyId("");
  };

  const removeSeason = async (seasonId: string) => {
    if (!confirm("Delete this season? Matches and practices tagged with it become unscheduled.")) return;
    setBusyId(seasonId);
    setErr("");
    const res = await fetch(`/api/groups/${groupId}/seasons/${seasonId}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErr(d.error || "Failed to delete season.");
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
            className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-gray-200 transition-colors"
          >
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
            </div>
            {canManage && (
              <>
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

/* ────── Notifications tab (PR #7 will fill this in) ────── */

function NotificationsTab() {
  return (
    <div className="text-center py-8">
      <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-court-green-pale/30 flex items-center justify-center text-court-green">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 01-3.46 0" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-gray-700">Per-team reminders</p>
      <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
        Coming soon — set how far in advance members get reminded about upcoming matches and practices.
      </p>
    </div>
  );
}
