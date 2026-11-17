import { teamPage } from "@/lib/onboarding/team-page";
import TeamRosterScreen from "@/components/groups/TeamRosterScreen";
export default async function RosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TeamRosterScreen {...await teamPage(id, "roster")} />;
}
