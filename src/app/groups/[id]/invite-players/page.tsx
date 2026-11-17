import { teamPage } from "@/lib/onboarding/team-page";
import TeamInvitations from "@/components/groups/TeamInvitations";
export default async function InvitePlayersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await teamPage(id, "invite-players");
  return <TeamInvitations group={data.group} currentUserName={data.currentUser.name} />;
}
