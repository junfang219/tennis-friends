"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import TeamRoster, { type RosterGroup } from "./TeamRoster";
import TeamSharedInvitations from "./TeamSharedInvitations";
import { useTeamManagement } from "./useTeamManagement";
import { canAdmin } from "@/lib/groupRoles";
function RosterRequests({ groupId, refresh }: { groupId: string; refresh: () => void }) {
  const { state, load, error } = useTeamManagement(groupId);
  return <>{error && <p role="alert" className="text-sm text-red-800">{error}</p>}{state && <TeamSharedInvitations view="requests" groupId={groupId} players={state.players.map(p => ({ id: p.id, name: p.name, phone: p.phone ?? "", email: p.email ?? "", memberId: p.accepted_by, associatedAccountId: p.associated_account_id, confirmedAt: p.confirmed_at, invitedAt: p.sent_at, remindedAt: null }))} onApproved={async () => { await load(); refresh(); }} onBusyChange={() => {}} />}</>;
}
export default function TeamRosterScreen({ group, currentUser }: { group: RosterGroup; currentUser: { id: string; name: string } }) {
  const router = useRouter();
  const canManage = canAdmin({ isOwner: group.ownerId === currentUser.id, roles: group.members.find(m => m.userId === currentUser.id)?.roles ?? [] });
  return <main className="max-w-2xl mx-auto p-4 py-6 space-y-5"><Link href={`/groups/${group.id}`} className="text-sm underline text-court-green">Back to team</Link><header><p className="text-sm text-gray-600 break-words">{group.name}</p><h1 className="font-display text-3xl font-bold text-court-green">Roster</h1><p className="text-sm text-gray-600 mt-2">Invite players whenever you’re ready. Members and approved join requests appear here.</p></header>
    <section className="rounded-2xl border border-gray-200 bg-white p-5"><TeamRoster group={group} canManage={canManage} currentUserId={currentUser.id} currentUserName={currentUser.name} onSaved={() => router.refresh()} />{group.members.length <= 1 && <p className="text-sm text-gray-600">Your team is ready. Use Invite players to share a link or send personal email invitations.</p>}</section>
    {canManage && <RosterRequests groupId={group.id} refresh={() => router.refresh()} />}
    {canManage && <Link href={`/groups/${group.id}/registration`} className="btn-secondary block text-center">USTA registration</Link>}
  </main>;
}
