import { notFound } from "next/navigation";
import { z } from "zod";
import { teamPage } from "@/lib/onboarding/team-page";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { onboardingDb } from "@/lib/onboarding/db";
import CreateTeamForm from "@/components/groups/CreateTeamForm";
export default async function SetupDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { group } = await teamPage(id, "setup-details");
  const { data, error } = await onboardingDb(await createSupabaseServerClient()).rpc("read_team_onboarding", { p_group: id });
  const parsed = z.object({ config: z.object({ description: z.string().optional() }).nullable() }).safeParse(data);
  if (error || !parsed.success) notFound();
  return <CreateTeamForm groupId={id} initialDetails={{ name: group.name, description: parsed.data.config?.description ?? "" }} />;
}
