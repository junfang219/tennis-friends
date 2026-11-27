import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { z } from "zod";
import RegistrationOnboarding from "@/components/groups/RegistrationOnboarding";
import CreateTeamForm from "@/components/groups/CreateTeamForm";
import TeamRosterScreen from "@/components/groups/TeamRosterScreen";
import { GroupSettingsPreview } from "@/components/groups/GroupSettings";
import TeamInvitations from "@/components/groups/TeamInvitations";
import TeamNextActionCard from "@/components/groups/TeamNextActionCard";
import { teamLanding } from "@/lib/teamLanding";
import TeamRegistration from "@/components/groups/TeamRegistration";
import SetupDetailsPreview from "@/components/groups/SetupDetailsPreview";
import SharedTeamInvitation from "@/components/groups/SharedTeamInvitation";
import { reviewGroup, reviewRosterMemberCookie, reviewTeamPath, reviewUser } from "@/lib/onboarding/review-fixture";

const previewMemberEdits = z.object({
  roles: z.array(z.enum(["manager", "captain"])).max(2).optional(),
  memberType: z.string().max(32).optional(),
});

function readMemberEdits(value: string) {
  try {
    const raw: unknown = JSON.parse(value);
    return previewMemberEdits.safeParse(raw).data ?? {};
  } catch {
    return {};
  }
}

export default async function OnboardingPreviewPage({ searchParams }: {
  searchParams: Promise<{ flow?: string | string[]; account?: string | string[]; setup?: string | string[]; from?: string | string[]; tab?: string | string[] }>;
}) {
  if (process.env.NODE_ENV !== "development" || process.env.TEAM_ONBOARDING_REVIEW !== "1") notFound();
  const query = z.object({
    flow: z.enum(["team", "shared", "create", "details", "roster", "settings", "invite", "invite-ready", "registration"]).optional(),
    setup: z.literal("1").optional(),
    account: z.literal("signed-out").optional(),
    from: z.literal("settings").optional().catch(undefined),
    tab: z.literal("roster").optional().catch(undefined),
  }).safeParse(await searchParams);
  if (!query.success) notFound();
  const group = reviewGroup;
  if (query.data.flow === "create") return <CreateTeamForm groupId={group.id} />;
  if (query.data.flow === "details") return <SetupDetailsPreview groupId={group.id} />;
  if (query.data.flow === "roster" || query.data.flow === "settings") {
    const savedMember = (await cookies()).get(reviewRosterMemberCookie)?.value;
    const edits = savedMember ? readMemberEdits(savedMember) : {};
    const rosterGroup = { ...group, members: group.members.map(member => ({ ...member, ...edits })) };
    return query.data.flow === "roster"
      ? <TeamRosterScreen group={rosterGroup} currentUser={reviewUser} />
      : <GroupSettingsPreview group={rosterGroup} currentUser={reviewUser} initialTab={query.data.tab ?? "team"} />;
  }
  if (query.data.flow === "team") {
    const landing = teamLanding({
      groupId: group.id, ownerId: group.ownerId, userId: reviewUser.id, onboardingEnabled: true, now: new Date(),
      members: group.members.map(member => ({
        id: member.id, user_id: member.userId, roles: member.roles, placeholder_scope: null,
      })),
      matches: [],
    });
    return (
      <main className="mx-auto max-w-lg p-4 py-8">
        <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
          <h1 className="font-display text-2xl font-bold text-court-green">{group.name}</h1>
          {landing && <TeamNextActionCard landing={landing} />}
          <Link className="btn-secondary block text-center" href={`${reviewTeamPath}/roster`}>View roster</Link>
          <Link className="btn-secondary block text-center" href={`${reviewTeamPath}/settings`}>Team settings</Link>
        </section>
      </main>
    );
  }
  if (query.data.flow === "invite") return <TeamInvitations group={group} currentUserName="Captain" setup={query.data.setup === "1"} fromSettings={query.data.from === "settings"} review />;
  // Fixed, fictional server snapshot for hydration/performance regressions only.
  if (query.data.flow === "invite-ready") return <TeamInvitations group={group} currentUserName="Captain" setup review initialState={{ config: { name: group.name, description: "Saved description", includeUsta: false, teamNumber: "", deadline: "" }, players: [], members: [], legacyInvitations: [], delivery: { sms: { configured: true, publicOrigin: true } } }} />;
  if (query.data.flow === "registration") return <main className="max-w-2xl mx-auto p-4 py-6 space-y-5"><h1 className="font-display text-3xl font-bold">USTA registration</h1><TeamRegistration groupId={group.id} /></main>;
  if (query.data.flow === "shared") return <SharedTeamInvitation token={"a".repeat(64)} info={{ groupId: "33333333-3333-4333-8333-333333333333", name: "Shared review", description: "An isolated team invitation", status: query.data.account ? "signed_out" : "ready" }} viewer={query.data.account ? null : { name: "New Player", email: "new@example.com" }} />;
  return <RegistrationOnboarding />;
}
