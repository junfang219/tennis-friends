import "server-only";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readTeamRoster } from "./roster-data";
import { canAdmin } from "@/lib/groupRoles";
import { readTeamManagement, TeamManagementReadError } from "./management-data";
export async function teamPage(id: string, section: "roster" | "invite-players" | "registration" | "setup-details") {
  if (!z.uuid().safeParse(id).success || process.env.NEXT_PUBLIC_TEAM_ONBOARDING_ENABLED !== "true") notFound();
  const db = await createSupabaseServerClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(`/groups/${id}/${section}`)}`);
  const roster = readTeamRoster(db, id);
  const management = section === "invite-players" ? readTeamManagement(db, id, roster).catch(error => {
    if (error instanceof TeamManagementReadError && [403, 404].includes(error.status)) notFound();
    throw error;
  }) : undefined;
  const [group, initialManagement] = await Promise.all([roster, management]);
  if (!group || (group.ownerId !== auth.user.id && !group.members.some(m => m.userId === auth.user.id))) notFound();
  const canManage = canAdmin({ isOwner: group.ownerId === auth.user.id, roles: group.members.find(m => m.userId === auth.user.id)?.roles ?? [] });
  if (section !== "roster" && !canManage) notFound();
  return { group, initialManagement, currentUser: { id: auth.user.id, name: auth.user.email ?? "" } };
}
