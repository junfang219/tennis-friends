import { notFound, redirect } from "next/navigation";
import { z } from "zod";
export default async function LegacyTeamSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success || process.env.NEXT_PUBLIC_TEAM_ONBOARDING_ENABLED !== "true") notFound();
  redirect(`/groups/${id}/roster`);
}
