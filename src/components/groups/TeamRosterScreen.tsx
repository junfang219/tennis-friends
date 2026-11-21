"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import TeamRoster, { type RosterGroup } from "./TeamRoster";
import TeamSharedInvitations from "./TeamSharedInvitations";
import { RegistrationEditor } from "./TeamRegistration";
import TeamMembershipActions from "./TeamMembershipActions";
import { useTeamManagement } from "./useTeamManagement";
import { canAdmin } from "@/lib/groupRoles";
import { registrationPlayers } from "@/lib/onboarding/management";
export function ManagedRoster({ group, currentUser, onRosterChanged, embedded = false }: {
  group: RosterGroup;
  currentUser: { id: string; name: string };
  onRosterChanged: () => void | Promise<void>;
  embedded?: boolean;
}) {
  const { state, load, mutate, error } = useTeamManagement(group.id);
  const tracked = state ? registrationPlayers(state) : [];
  return <>{error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    <section aria-label="Team members" className={embedded ? undefined : "rounded-2xl border border-gray-200 bg-white p-5"}>
      {state?.config.includeUsta && <p className="mb-4 text-sm text-gray-600">Check the TennisLink roster before confirming each player’s registration.</p>}
      <TeamRoster group={group} canManage currentUserId={currentUser.id} currentUserName={currentUser.name} onSaved={() => { void load().catch(() => {}); void onRosterChanged(); }} registration={state?.config.includeUsta ? { players: state.players, members: state.members, confirm: async (playerId, confirmed) => { await mutate({ action: "confirmation", playerId, confirmed }); } } : undefined} />
      {group.members.length <= 1 && <p className="text-sm text-gray-600">Your team is ready. Use Invite players to share a link or send personal email invitations.</p>}
    </section>
    {state && <>
      <details id="registration" className="rounded-2xl border border-gray-200 bg-white p-5"><summary className="cursor-pointer font-semibold text-court-green">USTA registration · {state.config.includeUsta ? `${tracked.filter(p => p.confirmed_at).length} of ${tracked.length} confirmed` : "Not enabled"}</summary><div className="pt-4"><RegistrationEditor groupId={group.id} state={state} load={load} mutate={mutate} hideConfirmations /></div></details>
      <TeamSharedInvitations view="requests" groupId={group.id} players={state.players.map(p => ({ id: p.id, name: p.name, phone: p.phone ?? "", email: p.email ?? "", memberId: p.accepted_by, associatedAccountId: p.associated_account_id, confirmedAt: p.confirmed_at, invitedAt: p.sent_at, remindedAt: null }))} onApproved={async () => { await load(); await onRosterChanged(); }} onBusyChange={() => {}} />
    </>}
  </>;
}
export default function TeamRosterScreen({ group, currentUser }: { group: RosterGroup; currentUser: { id: string; name: string } }) {
  const router = useRouter();
  const canManage = canAdmin({ isOwner: group.ownerId === currentUser.id, roles: group.members.find(m => m.userId === currentUser.id)?.roles ?? [] });
  return <main className="max-w-2xl mx-auto p-4 py-6 space-y-5"><Link href={`/groups/${group.id}`} className="text-sm underline text-court-green">Back to team</Link><header><p className="text-sm text-gray-600 break-words">{group.name}</p><h1 className="font-display text-3xl font-bold text-court-green">Roster</h1><p className="text-sm text-gray-600 mt-2">Manage players, invitations, and USTA registration here.</p></header>
    {canManage ? <ManagedRoster group={group} currentUser={currentUser} onRosterChanged={() => router.refresh()} /> : <section className="rounded-2xl border border-gray-200 bg-white p-5"><TeamRoster group={group} canManage={false} currentUserId={currentUser.id} currentUserName={currentUser.name} onSaved={() => {}} /></section>}
    <TeamMembershipActions groupId={group.id} isOwner={group.ownerId === currentUser.id} />
  </main>;
}
