import { Suspense } from "react";
import TeamNextActionCard from "@/components/groups/TeamNextActionCard";
import { readTeamLanding } from "@/lib/teamLanding.server";
import TeamPageClient from "./TeamPageClient";

async function TeamNextAction({ id }: { id: string }) {
  // The team overview and its existing links remain usable if the summary
  // cannot be loaded independently of the team feed.
  const landing = await readTeamLanding(id).catch(() => null);
  return landing && <TeamNextActionCard landing={landing} />;
}

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <TeamPageClient key={id} id={id} nextAction={(
      <Suspense fallback={null}>
        <TeamNextAction id={id} />
      </Suspense>
    )} />
  );
}
