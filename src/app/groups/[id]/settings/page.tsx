"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import { DEFAULT_MEMBER_TYPES, isAtLeast, ROLE } from "@/lib/groupRoles";
import { parseReminderPrefs, REMINDER_HOUR_CHOICES, type ReminderPrefs } from "@/lib/reminderPrefs";

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
  reminderPrefs: string; // JSON-encoded { matchHours, practiceHours }
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

type Invite = {
  id: string;
  email: string;
  role: string;
  memberType: string;
  status: string;
  createdAt: string;
  invitedBy: { id: string; name: string };
};

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

  // Invites — fetched once and refreshed after send/cancel.
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>(ROLE.MEMBER);
  const [inviteType, setInviteType] = useState("");
  const [sending, setSending] = useState(false);
  const [inviteMsg, setInviteMsg] = useState("");
  const [inviteErr, setInviteErr] = useState("");

  const loadInvites = useCallback(async () => {
    const res = await fetch(`/api/groups/${group.id}/invites`);
    if (res.ok) setInvites(await res.json());
  }, [group.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadInvites();
  }, [loadInvites]);

  const sendInvite = async () => {
    if (!inviteEmail.trim()) return;
    setSending(true);
    setInviteErr("");
    setInviteMsg("");
    const res = await fetch(`/api/groups/${group.id}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: inviteEmail.trim(),
        role: inviteRole,
        memberType: inviteType,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.emailError) {
        setInviteMsg(`Invite saved, but email send failed: ${data.emailError}`);
      } else {
        setInviteMsg(`Invite sent to ${inviteEmail.trim()}.`);
      }
      setInviteEmail("");
      setInviteType("");
      void loadInvites();
    } else {
      const d = await res.json().catch(() => ({}));
      setInviteErr(d.error || "Failed to send invite.");
    }
    setSending(false);
  };

  const cancelInvite = async (inviteId: string) => {
    setInviteErr("");
    const res = await fetch(`/api/groups/${group.id}/invites/${inviteId}`, { method: "DELETE" });
    if (res.ok) {
      void loadInvites();
    } else {
      const d = await res.json().catch(() => ({}));
      setInviteErr(d.error || "Failed to cancel invite.");
    }
  };

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

      {/* ── Pending invites ── */}
      {invites.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
            Pending invites
          </h3>
          <div className="space-y-2">
            {invites.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center gap-3 px-3 py-2 rounded-xl border border-gray-100 bg-amber-50/40"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600 shrink-0">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{inv.email}</p>
                  <p className="text-[11px] text-gray-500">
                    Invited by {inv.invitedBy.name} · {inv.role.toLowerCase()}{inv.memberType ? ` · ${inv.memberType}` : ""}
                  </p>
                </div>
                {canManage && (
                  <button
                    onClick={() => cancelInvite(inv.id)}
                    className="text-xs font-semibold text-red-500 hover:text-red-600"
                  >
                    Cancel
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Invite by email ── */}
      {canManage && (
        <div className="mt-6">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
            Invite by email
          </h3>
          <div className="p-3 rounded-xl border border-gray-200 bg-gray-50 space-y-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-court-green"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="text-xs px-2 py-2 border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-court-green"
              >
                <option value={ROLE.MEMBER}>Member</option>
                <option value={ROLE.CAPTAIN}>Captain</option>
                {callerIsOwner && <option value={ROLE.MANAGER}>Manager</option>}
              </select>
              <select
                value={inviteType}
                onChange={(e) => setInviteType(e.target.value)}
                disabled={types.length === 0}
                className="text-xs px-2 py-2 border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-court-green"
              >
                <option value="">No member type</option>
                {types.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <button
              onClick={sendInvite}
              disabled={sending || !inviteEmail.trim()}
              className="btn-primary w-full"
            >
              {sending ? "Sending..." : "Send invite"}
            </button>
            {inviteMsg && <p className="text-xs text-court-green">{inviteMsg}</p>}
            {inviteErr && <p className="text-xs text-red-600">{inviteErr}</p>}
          </div>
        </div>
      )}
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
    const res = await fetch("/api/groups", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: group.id, reminderPrefs: prefs }),
    });
    if (res.ok) {
      setMsg("Reminder preferences saved.");
      onSaved();
    } else {
      const d = await res.json().catch(() => ({}));
      setErr(d.error || "Failed to save.");
    }
    setSaving(false);
  };

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">
        Members who haven&apos;t RSVPed get a push + email at each lead time you select.
        Cron runs hourly — exact dispatch time can drift by up to 30 minutes.
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
