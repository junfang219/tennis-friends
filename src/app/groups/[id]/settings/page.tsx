"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import { canAdmin, parseMemberTypes, TEAM_ROLES, type TeamRole } from "@/lib/groupRoles";
import { parseReminderPrefs, REMINDER_HOUR_CHOICES, type ReminderPrefs } from "@/lib/reminderPrefs";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getGroup, listGroupMembers } from "@/lib/supabase/queries";
import { errorMessage } from "@/lib/errorMessage";

type Member = {
  id: string;
  userId: string;
  roles: TeamRole[];
  memberType: string;
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
};

type TabKey = "team" | "roster" | "seasons" | "notifications";

const TABS: { key: TabKey; label: string }[] = [
  { key: "team", label: "Team" },
  { key: "roster", label: "Roster" },
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
      .select("id, name, start_date, end_date, group_id")
      .eq("group_id", groupId)
      .order("start_date", { ascending: false });
    setSeasons(
      (data ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        startDate: s.start_date,
        endDate: s.end_date,
        groupId: s.group_id,
      })) as unknown as typeof seasons
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

type Invite = {
  id: string;
  email: string;
  roles: TeamRole[];
  memberType: string;
  status: string;
  createdAt: string;
  invitedBy: { id: string; name: string };
};

// Human label for a role set: "Manager · Captain", or "Member" when empty.
function rolesLabel(roles: TeamRole[]): string {
  if (roles.length === 0) return "Member";
  return TEAM_ROLES.filter((r) => roles.includes(r.value)).map((r) => r.label).join(" · ");
}

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
  const types = parseMemberTypes(group.memberTypes);
  const callerIsOwner = currentUserId === group.ownerId;
  const [busyId, setBusyId] = useState("");
  const [err, setErr] = useState("");

  // Invites — fetched once and refreshed after send/cancel.
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoles, setInviteRoles] = useState<TeamRole[]>([]);
  const [inviteType, setInviteType] = useState("");
  const [sending, setSending] = useState(false);
  const [inviteMsg, setInviteMsg] = useState("");
  const [inviteErr, setInviteErr] = useState("");

  const loadInvites = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase
      .from("group_invites")
      .select(
        "id, email, roles, member_type, status, expires_at, accepted_by_id, accepted_at, created_at, invited_by_id, token"
      )
      .eq("group_id", group.id)
      .order("created_at", { ascending: false });
    setInvites(
      (data ?? []).map((i) => ({
        id: i.id,
        email: i.email,
        roles: i.roles,
        memberType: i.member_type,
        status: i.status,
        expiresAt: i.expires_at,
        acceptedById: i.accepted_by_id,
        acceptedAt: i.accepted_at,
        createdAt: i.created_at,
        token: i.token,
      })) as unknown as typeof invites
    );
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
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Not signed in");
      // Token: 24 hex chars. Cheap unique random.
      const token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const { error: insErr } = await supabase.from("group_invites").insert({
        group_id: group.id,
        email: inviteEmail.trim(),
        roles: inviteRoles,
        member_type: inviteType,
        token,
        invited_by_id: auth.user.id,
        // 30-day expiry by default.
        expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
      });
      if (insErr) throw insErr;
      setInviteMsg(`Invite saved for ${inviteEmail.trim()}. Email dispatch is owned by an Edge Function — needs reinstatement before launch.`);
      setInviteEmail("");
      setInviteType("");
      setInviteRoles([]);
      void loadInvites();
    } catch (err) {
      setInviteErr(errorMessage(err, "Failed to send invite."));
    }
    setSending(false);
  };

  const cancelInvite = async (inviteId: string) => {
    setInviteErr("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: delErr } = await supabase
        .from("group_invites")
        .update({ status: "cancelled" })
        .eq("id", inviteId);
      if (delErr) throw delErr;
      void loadInvites();
    } catch (err) {
      setInviteErr(errorMessage(err, "Failed to cancel invite."));
    }
  };

  const updateMember = async (memberId: string, patch: { roles?: TeamRole[]; memberType?: string }) => {
    setBusyId(memberId);
    setErr("");
    const supabase = createSupabaseBrowserClient();
    const dbPatch: { roles?: TeamRole[]; member_type?: string } = {};
    if (patch.roles !== undefined) dbPatch.roles = patch.roles;
    if (patch.memberType !== undefined) dbPatch.member_type = patch.memberType;
    const { error: upErr } = await supabase
      .from("group_members")
      .update(dbPatch)
      .eq("id", memberId);
    if (upErr) {
      setErr(upErr.message || "Failed to save.");
    } else {
      onSaved();
    }
    setBusyId("");
  };

  // Add/remove one role from a member's set. Manager is owner-gated below.
  const toggleRole = (m: Member, role: TeamRole) => {
    const next = m.roles.includes(role)
      ? m.roles.filter((r) => r !== role)
      : [...m.roles, role];
    void updateMember(m.id, { roles: next });
  };

  const transferOwnership = async (m: Member) => {
    if (
      !window.confirm(
        `Make ${m.user.name} the owner of this team? You'll stay on as a manager and captain, but ${m.user.name} will control the team and can remove anyone.`
      )
    )
      return;
    setBusyId(m.id);
    setErr("");
    const supabase = createSupabaseBrowserClient();
    const { error: rpcErr } = await supabase.rpc("transfer_group_ownership", {
      p_group_id: group.id,
      p_new_owner_id: m.userId,
    });
    if (rpcErr) {
      setErr(rpcErr.message || "Failed to transfer ownership.");
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

          return (
            <div key={m.id} className="flex items-start gap-3 py-3">
              <Avatar name={m.user.name} image={m.user.profileImageUrl} size="md" />
              <div className="flex-1 min-w-0">
                {/* Identity */}
                <div className="flex items-center gap-2 flex-wrap">
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

                {canManage ? (
                  <>
                    {/* Role toggles + member-type wrap onto their own line so the
                        name keeps full width. Manager = admin, Captain = ops;
                        both independent. The owner always has both but their row
                        stays editable. Manager is owner-gated. */}
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      {TEAM_ROLES.map((r) => {
                        const on = m.roles.includes(r.value);
                        const lockedManager = r.value === "manager" && !callerIsOwner;
                        return (
                          <button
                            key={r.value}
                            type="button"
                            onClick={() => toggleRole(m, r.value)}
                            disabled={busyId === m.id || lockedManager}
                            title={lockedManager ? "Only the team owner can assign Manager" : undefined}
                            aria-pressed={on}
                            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                              on
                                ? "bg-court-green text-white border-court-green"
                                : "bg-white text-gray-500 border-gray-200 hover:border-court-green"
                            } ${lockedManager ? "opacity-40 cursor-not-allowed" : ""}`}
                          >
                            {r.label}
                          </button>
                        );
                      })}
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
                        {/* Preserve a label removed from the team's list but still
                            assigned to this member, so the picker isn't blank. */}
                        {m.memberType && !types.includes(m.memberType) && (
                          <option value={m.memberType}>{m.memberType} (removed)</option>
                        )}
                      </select>
                    </div>
                    {/* Ownership transfer — only the current owner, on other rows. */}
                    {callerIsOwner && !isOwnerRow && (
                      <button
                        type="button"
                        onClick={() => transferOwnership(m)}
                        disabled={busyId === m.id}
                        className="text-[11px] font-semibold text-court-green hover:underline mt-1.5 disabled:opacity-50"
                      >
                        Make owner
                      </button>
                    )}
                  </>
                ) : (
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {isOwnerRow ? "Owner" : rolesLabel(m.roles)}
                    {m.memberType ? ` · ${m.memberType}` : ""}
                  </p>
                )}
              </div>
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
                    Invited by {inv.invitedBy.name} · {rolesLabel(inv.roles)}{inv.memberType ? ` · ${inv.memberType}` : ""}
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
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Roles
              </span>
              {TEAM_ROLES.map((r) => {
                const on = inviteRoles.includes(r.value);
                const lockedManager = r.value === "manager" && !callerIsOwner;
                return (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() =>
                      setInviteRoles((prev) =>
                        prev.includes(r.value)
                          ? prev.filter((x) => x !== r.value)
                          : [...prev, r.value]
                      )
                    }
                    disabled={lockedManager}
                    title={lockedManager ? "Only the team owner can assign Manager" : undefined}
                    aria-pressed={on}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                      on
                        ? "bg-court-green text-white border-court-green"
                        : "bg-white text-gray-500 border-gray-200 hover:border-court-green"
                    } ${lockedManager ? "opacity-40 cursor-not-allowed" : ""}`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
            <select
              value={inviteType}
              onChange={(e) => setInviteType(e.target.value)}
              disabled={types.length === 0}
              className="w-full text-xs px-2 py-2 border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-court-green"
            >
              <option value="">No member type</option>
              {types.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
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
    });
    if (!insErr) {
      setShowCreate(false);
      setNewName("");
      setNewStart("");
      setNewEnd("");
      setNewActive(true);
      onSaved();
    } else {
      setErr(insErr.message || "Failed to create season.");
    }
    setSaving(false);
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
