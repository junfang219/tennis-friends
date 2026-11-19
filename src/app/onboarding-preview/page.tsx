import { notFound } from "next/navigation";
import { z } from "zod";
import RegistrationOnboarding from "@/components/groups/RegistrationOnboarding";
import CreateTeamForm from "@/components/groups/CreateTeamForm";
import TeamRosterScreen from "@/components/groups/TeamRosterScreen";
import TeamInvitations from "@/components/groups/TeamInvitations";
import TeamRegistration from "@/components/groups/TeamRegistration";
import SetupDetailsPreview from "@/components/groups/SetupDetailsPreview";
import SharedTeamInvitation from "@/components/groups/SharedTeamInvitation";

export default async function OnboardingPreviewPage({ searchParams }: {
  searchParams: Promise<{ flow?: string | string[]; account?: string | string[]; setup?: string | string[] }>;
}) {
  if (process.env.NODE_ENV !== "development" || process.env.TEAM_ONBOARDING_REVIEW !== "1") notFound();
  const query = z.object({ flow: z.enum(["team", "shared", "create", "details", "roster", "invite", "invite-ready", "registration"]).optional(), setup: z.literal("1").optional(), account: z.literal("signed-out").optional() }).safeParse(await searchParams);
  if (!query.success) notFound();
  // Playwright supplies isolated API fixtures for the production component.
  // Review middleware blocks its API URLs if no fixture handles a request.
  const group = { id: "33333333-3333-4333-8333-333333333333", name: "Shared review", ownerId: "11111111-1111-4111-8111-111111111111", memberTypes: [], members: [{ id: "88888888-8888-4888-8888-888888888888", userId: "11111111-1111-4111-8111-111111111111", roles: [], memberType: "", isPlaceholder: false, user: { id: "11111111-1111-4111-8111-111111111111", name: "Captain", profileImageUrl: "" } }] };
  if (query.data.flow === "create") return <CreateTeamForm groupId={group.id} />;
  if (query.data.flow === "details") return <SetupDetailsPreview groupId={group.id} />;
  if (query.data.flow === "team" || query.data.flow === "roster") return <TeamRosterScreen group={group} currentUser={{ id: group.ownerId, name: "Captain" }} />;
  if (query.data.flow === "invite") return <TeamInvitations group={group} currentUserName="Captain" setup={query.data.setup === "1"} review />;
  // Fixed, fictional server snapshot for hydration/performance regressions only.
  if (query.data.flow === "invite-ready") return <TeamInvitations group={group} currentUserName="Captain" setup review initialState={{ config: { name: group.name, description: "Saved description", includeUsta: false, teamNumber: "", deadline: "" }, players: [], members: [], legacyInvitations: [], delivery: { sms: { configured: true, publicOrigin: true } } }} />;
  if (query.data.flow === "registration") return <main className="max-w-2xl mx-auto p-4 py-6 space-y-5"><h1 className="font-display text-3xl font-bold">USTA registration</h1><TeamRegistration groupId={group.id} /></main>;
  if (query.data.flow === "shared") return <SharedTeamInvitation token={"a".repeat(64)} info={{ groupId: "33333333-3333-4333-8333-333333333333", name: "Shared review", description: "An isolated team invitation", status: query.data.account ? "signed_out" : "ready" }} viewer={query.data.account ? null : { name: "New Player", email: "new@example.com" }} />;
  return <RegistrationOnboarding />;
}
