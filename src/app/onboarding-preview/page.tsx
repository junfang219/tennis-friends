import { notFound } from "next/navigation";
import { z } from "zod";
import RegistrationOnboarding from "@/components/groups/RegistrationOnboarding";
import TeamOnboarding from "@/components/groups/TeamOnboarding";
import SharedTeamInvitation from "@/components/groups/SharedTeamInvitation";

export default async function OnboardingPreviewPage({ searchParams }: {
  searchParams: Promise<{ flow?: string | string[]; account?: string | string[] }>;
}) {
  if (process.env.NODE_ENV !== "development" || process.env.TEAM_ONBOARDING_REVIEW !== "1") notFound();
  const query = z.object({ flow: z.enum(["team", "shared"]).optional(), account: z.literal("signed-out").optional() }).safeParse(await searchParams);
  if (!query.success) notFound();
  // Playwright supplies isolated API fixtures for the production component.
  // Review middleware blocks its API URLs if no fixture handles a request.
  if (query.data.flow === "team") return <TeamOnboarding groupId="33333333-3333-4333-8333-333333333333" />;
  if (query.data.flow === "shared") return <SharedTeamInvitation token={"a".repeat(64)} info={{ groupId: "33333333-3333-4333-8333-333333333333", name: "Shared review", description: "An isolated team invitation", status: query.data.account ? "signed_out" : "ready" }} viewer={query.data.account ? null : { name: "New Player", email: "new@example.com" }} />;
  return <RegistrationOnboarding />;
}
