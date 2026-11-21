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
type MemberEdit = Partial<Pick<RosterMember, "roles" | "memberType">>;
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
  inviteFromSettings = false,
  registration,
}: {
  group: RosterGroup;
  canManage: boolean;
  currentUserId: string;
  currentUserName: string;
  onSaved: (memberEdit?: MemberEdit) => void | Promise<void>;
  inviteFromSettings?: boolean;
  registration?: { players: { id: string; member_id: string | null; accepted_by: string | null; confirmed_at: string | null }[]; members: { id: string }[]; confirm: (playerId: string, confirmed: boolean) => Promise<void> };
}) {
  const types = parseMemberTypes(group.memberTypes);
  const callerIsOwner = currentUserId === group.ownerId;
  const [roster, setRoster] = useState({ source: group.members, members: group.members });
  const [pendingChanges, setPendingChanges] = useState<Record<string, { patch?: MemberEdit }>>({});
  const [err, setErr] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState<{ memberId: string; confirmed: boolean } | null>(null);
  // Placeholder row whose "Link to account" picker is open, if any.
  const [linkTarget, setLinkTarget] = useState<{ id: string; name: string } | null>(null);
  // Per-row "⋯" actions menu (Link / Make owner / Remove), anchored to the button.
  const [rowMenu, setRowMenu] = useState<{ memberId: string; top: number; left: number } | null>(null);

  // "Add people" chooser (forks invite-to-team vs availability-only).
  const [showAddPeople, setShowAddPeople] = useState(false);

  if (roster.source !== group.members) {
    setRoster({ source: group.members, members: group.members });
  }

  async function changeRoster(memberId: string, action: "member" | "remove" | "transfer-owner", patch?: MemberEdit) {
    if (pendingChanges[memberId]) return;
    setPendingChanges(previous => ({ ...previous, [memberId]: { patch } }));
    setErr("");
    try {
      await teamResponse(await fetch(`/api/team-roster/${group.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, memberId, ...patch }) }));
      if (patch) {
        setRoster(previous => ({ ...previous, members: previous.members.map(member => member.id === memberId ? { ...member, ...patch } : member) }));
      }
      await onSaved(patch);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not update roster"); }
    finally {
      setPendingChanges(previous => {
        const next = { ...previous };
        delete next[memberId];
        return next;
      });
    }
  }

  async function changeConfirmation(memberId: string, playerId: string, confirmed: boolean) {
    if (!registration || pendingConfirmation) return;
    setPendingConfirmation({ memberId, confirmed });
    setErr("");
    try {
      await registration.confirm(playerId, confirmed);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Could not save registration confirmation");
    } finally {
      setPendingConfirmation(null);
    }
  }

  // Add/remove one role from a member's set. Manager is owner-gated below.
  const toggleRole = (m: RosterMember, role: TeamRole) => {
    const next = m.roles.includes(role)
      ? m.roles.filter((r) => r !== role)
      : [...m.roles, role];
    void changeRoster(m.id, "member", { roles: next });
  };

  const transferOwnership = async (m: RosterMember) => {
    if (!m.userId) return;
    if (
      !window.confirm(
        `Make ${m.user.name} the owner of this team? You'll stay on as a manager and captain, but ${m.user.name} will control the team and can remove anyone.`
      )
    )
      return;
    await changeRoster(m.id, "transfer-owner");
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
    await changeRoster(m.id, "remove");
  };

  return (
    <div>
      {canManage && (process.env.NEXT_PUBLIC_TEAM_ONBOARDING_ENABLED === "true" ? <Link href={`/groups/${group.id}/invite-players${inviteFromSettings ? "?from=settings" : ""}`} className="btn-primary inline-flex items-center justify-center min-h-12 mb-4">Invite players</Link> :
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
        {roster.members.map((member) => {
          const pending = pendingChanges[member.id];
          const m = pending?.patch ? { ...member, ...pending.patch } : member;
          const isOwnerRow = m.userId === group.ownerId;
          const tracked = registration?.players.find(p => p.member_id === m.id || (m.userId && p.accepted_by === m.userId));
          const registrationEligible = Boolean(tracked || (m.userId && registration?.members.some(member => member.id === m.id)));
          const isSavingConfirmation = pendingConfirmation?.memberId === m.id;
          const confirmed = isSavingConfirmation ? pendingConfirmation.confirmed : Boolean(tracked?.confirmed_at);
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
                            disabled={Boolean(pending) || lockedManager}
                            title={lockedManager ? "Only the team owner can assign Manager" : undefined}
                            aria-pressed={on}
                            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
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
                        aria-label={`Member type for ${m.user.name}`}
                        onChange={(e) => void changeRoster(m.id, "member", { memberType: e.currentTarget.value })}
                        disabled={Boolean(pending) || types.length === 0}
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
                {registrationEligible && (canManage ? (
                  <label className="mt-1 inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-gray-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-court-green"
                      checked={confirmed}
                      disabled={pendingConfirmation !== null || Boolean(pending)}
                      aria-label={`USTA registration confirmed for ${m.user.name}`}
                      onChange={(event) => void changeConfirmation(m.id, tracked?.id ?? m.id, event.currentTarget.checked)}
                    />
                    <span>USTA registration confirmed</span>
                    {isSavingConfirmation && <span role="status">Saving…</span>}
                  </label>
                ) : (
                  <p className="mt-3 text-sm font-semibold text-gray-700">USTA: {confirmed ? "Confirmed by captain" : "Unconfirmed"}</p>
                ))}
              </div>
              {showRowMenu && (
                <button
                  type="button"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setRowMenu({ memberId: m.id, top: r.bottom + 6, left: Math.max(8, r.right - 180) });
                  }}
                  disabled={Boolean(pending)}
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

      {err && <p role="alert" className="mt-3 text-sm text-red-800">{err}</p>}

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
