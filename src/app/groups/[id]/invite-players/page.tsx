import { z } from "zod";
import { notFound } from "next/navigation";
import { teamPage } from "@/lib/onboarding/team-page";
import TeamInvitations from "@/components/groups/TeamInvitations";
export default async function InvitePlayersPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ setup?: string | string[]; from?: string | string[] }>;
}) {
  const { id } = await params;
  const query = z.object({
    setup: z.literal("1").optional(),
    from: z.literal("settings").optional().catch(undefined),
  }).safeParse(await searchParams);
  if (!query.success) notFound();
  const data = await teamPage(id, "invite-players");
  return <TeamInvitations group={data.group} initialState={data.initialManagement} currentUserName={data.currentUser.name} setup={query.data.setup === "1"} fromSettings={query.data.from === "settings"} />;
}
