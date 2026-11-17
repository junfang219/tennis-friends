"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import { parseMemberTypes, TEAM_ROLES, type TeamRole } from "@/lib/groupRoles";
import { teamResponse } from "./useTeamManagement";
import LinkMemberModal from "./LinkMemberModal";
import AddPeopleChooser from "./AddPeopleChooser";
export type RosterMember = { id: string; userId: string | null; roles: TeamRole[]; memberType: string; isPlaceholder: boolean; user: { id: string; name: string; profileImageUrl: string } };
export type RosterGroup = { id: string; name: string; ownerId: string; memberTypes: string[]; members: RosterMember[] };
// Human label for a role set: "Manager · Captain", or "Member" when empty.
function rolesLabel(roles: TeamRole[]): string {
  if (roles.length === 0) return "Member";
  return TEAM_ROLES.filter((r) => roles.includes(r.value)).map((r) => r.label).join(" · ");
}

export default function TeamRoster({
  group,
  canManage,
  currentUserId,
  currentUserName,
  onSaved,
}: {
  group: RosterGroup;
  canManage: boolean;
  currentUserId: string;
  currentUserName: string;
  onSaved: () => void;
}) {
  const types = parseMemberTypes(group.memberTypes);
  const callerIsOwner = currentUserId === group.ownerId;
  const [busyId, setBusyId] = useState("");
  const [err, setErr] = useState("");
  // Placeholder row whose "Link to account" picker is open, if any.
  const [linkTarget, setLinkTarget] = useState<{ id: string; name: string } | null>(null);
  // Per-row "⋯" actions menu (Link / Make owner / Remove), anchored to the button.
  const [rowMenu, setRowMenu] = useState<{ memberId: string; top: number; left: number } | null>(null);

  // "Add people" chooser (forks invite-to-team vs availability-only).
  const [showAddPeople, setShowAddPeople] = useState(false);


  async function changeRoster(memberId: string, change: Record<string, unknown>) {
    setBusyId(memberId); setErr("");
    try {
      await teamResponse(await fetch(`/api/team-roster/${group.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...change, memberId }) }));
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not update roster"); }
    finally { setBusyId(""); }
  }
  const updateMember = (memberId: string, patch: { roles?: TeamRole[]; memberType?: string }) => changeRoster(memberId, { action: "member", ...patch });

  // Add/remove one role from a member's set. Manager is owner-gated below.
  const toggleRole = (m: RosterMember, role: TeamRole) => {
    const next = m.roles.includes(role)
      ? m.roles.filter((r) => r !== role)
      : [...m.roles, role];
    void updateMember(m.id, { roles: next });
  };

  const transferOwnership = async (m: RosterMember) => {
    if (!m.userId) return;
    if (
      !window.confirm(
        `Make ${m.user.name} the owner of this team? You'll stay on as a manager and captain, but ${m.user.name} will control the team and can remove anyone.`
      )
    )
      return;
    await changeRoster(m.id, { action: "transfer-owner" });
  };

  // Remove a member (or placeholder) from the roster. Hard-deletes the
  // group_members row — RLS (can_admin_group) lets an owner/manager do this;
  // the row's availabilities/poll responses cascade away.
  const removeMember = async (m: RosterMember) => {
    if (
      !window.confirm(
        m.isPlaceholder
          ? `Remove ${m.user.name} from the roster? Their availability entries will be cleared.`
          : `Remove ${m.user.name} from the team? They'll lose access to team chat and matches, and their availability will be cleared.`
      )
    )
      return;
    await changeRoster(m.id, { action: "remove" });
  };

  return (
    <div>
      {canManage && (process.env.NEXT_PUBLIC_TEAM_ONBOARDING_ENABLED === "true" ? <Link href={`/groups/${group.id}/invite-players`} className="btn-primary inline-flex items-center justify-center min-h-12 mb-4">Invite players</Link> :
        <button
          onClick={() => setShowAddPeople(true)}
          className="btn-primary btn-sm inline-flex items-center gap-1.5 mb-4"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="19" y1="8" x2="19" y2="14" />
            <line x1="22" y1="11" x2="16" y2="11" />
          </svg>
          Invite players
        </button>
      )}
      <p className="text-xs text-gray-500 mb-3">
        Promote managers and captains, or label members by type.
      </p>
      <div className="divide-y divide-gray-100">
        {group.members.map((m) => {
          const isOwnerRow = m.userId === group.ownerId;
          // Row actions collapsed into the "⋯" menu (owner/manager only).
          const canRemoveRow = !isOwnerRow && m.userId !== currentUserId;
          const canMakeOwnerRow = callerIsOwner && !isOwnerRow && !m.isPlaceholder;
          const showRowMenu = canManage && (m.isPlaceholder || canMakeOwnerRow || canRemoveRow);

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
                  {m.isPlaceholder && (
                    <span className="text-[9px] font-bold tracking-wider text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded uppercase">
                      No account
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
                  </>
                ) : (
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {isOwnerRow ? "Owner" : rolesLabel(m.roles)}
                    {m.memberType ? ` · ${m.memberType}` : ""}
                  </p>
                )}
              </div>
              {showRowMenu && (
                <button
                  type="button"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setRowMenu({ memberId: m.id, top: r.bottom + 6, left: Math.max(8, r.right - 180) });
                  }}
                  disabled={busyId === m.id}
                  className="shrink-0 -mr-1 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                  aria-label={`Manage ${m.user.name}`}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="5" r="1.6" />
                    <circle cx="12" cy="12" r="1.6" />
                    <circle cx="12" cy="19" r="1.6" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Per-row actions menu (portal so it escapes the list clipping). */}
      {rowMenu && typeof document !== "undefined" && (() => {
        const mm = group.members.find((x) => x.id === rowMenu.memberId);
        if (!mm) return null;
        const rowIsOwner = mm.userId === group.ownerId;
        const showMakeOwner = callerIsOwner && !rowIsOwner && !mm.isPlaceholder;
        const showRemove = !rowIsOwner && mm.userId !== currentUserId;
        return createPortal(
          <>
            <div className="fixed inset-0 z-[998]" onClick={() => setRowMenu(null)} />
            <div
              className="fixed z-[999] w-44 bg-white rounded-xl shadow-2xl border border-gray-200 p-1.5"
              style={{ top: rowMenu.top, left: rowMenu.left }}
            >
              {mm.isPlaceholder && (
                <button
                  type="button"
                  onClick={() => {
                    setRowMenu(null);
                    setLinkTarget({ id: mm.id, name: mm.user.name });
                  }}
                  className="w-full text-left px-2.5 py-2 rounded-lg text-sm text-gray-800 hover:bg-gray-50"
                >
                  Link to account
                </button>
              )}
              {showMakeOwner && (
                <button
                  type="button"
                  onClick={() => {
                    setRowMenu(null);
                    void transferOwnership(mm);
                  }}
                  className="w-full text-left px-2.5 py-2 rounded-lg text-sm text-gray-800 hover:bg-gray-50"
                >
                  Make owner
                </button>
              )}
              {showRemove && (
                <button
                  type="button"
                  onClick={() => {
                    setRowMenu(null);
                    void removeMember(mm);
                  }}
                  className="w-full text-left px-2.5 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50"
                >
                  Remove from team
                </button>
              )}
            </div>
          </>,
          document.body
        );
      })()}

      {err && <p className="text-xs text-red-600 mt-3">{err}</p>}

      {linkTarget && (
        <LinkMemberModal
          member={linkTarget}
          existingMemberUserIds={group.members
            .filter((mm) => !mm.isPlaceholder && mm.userId)
            .map((mm) => mm.userId).filter((id): id is string => Boolean(id))}
          onClose={() => setLinkTarget(null)}
          onLinked={() => {
            setLinkTarget(null);
            onSaved();
          }}
        />
      )}

      {showAddPeople && (
        <AddPeopleChooser
          groupId={group.id}
          groupName={group.name}
          memberTypes={types}
          callerIsOwner={callerIsOwner}
          currentUserName={currentUserName}
          existingMemberUserIds={group.members
            .filter((mm) => !mm.isPlaceholder && mm.userId)
            .map((mm) => mm.userId).filter((id): id is string => Boolean(id))}
          onClose={() => setShowAddPeople(false)}
          onChanged={onSaved}
        />
      )}
    </div>
  );
}
