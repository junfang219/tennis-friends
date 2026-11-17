import { notFound } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { onboardingDb } from "@/lib/onboarding/db";
import { sharedTeamInvitationSchema, teamLinkTokenSchema } from "@/lib/onboarding/shared";
import SharedTeamInvitation from "@/components/groups/SharedTeamInvitation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join a team | TennisFriends", referrer: "no-referrer" };
export default async function SharedTeamInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!teamLinkTokenSchema.safeParse(token).success) notFound();
  const db = await createSupabaseServerClient();
  const [{ data }, { data: auth }] = await Promise.all([
    onboardingDb(db).rpc("view_team_join_link", { p_token: token }), db.auth.getUser(),
  ]);
  const parsed = sharedTeamInvitationSchema.safeParse(data);
  if (!parsed.success) return <main className="max-w-lg mx-auto p-4 py-8"><h1 className="text-2xl font-bold">Team link unavailable</h1><p className="mt-4">Ask your captain for the current invitation link.</p></main>;
  const name = z.string().safeParse(auth.user?.user_metadata?.name);
  return <SharedTeamInvitation token={token} info={parsed.data} viewer={auth.user ? {
    name: name.success ? name.data : auth.user.email ?? "your account", email: auth.user.email ?? null,
  } : null} />;
}
