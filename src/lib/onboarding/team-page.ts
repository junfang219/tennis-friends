import "server-only";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getGroup, listGroupMembers } from "@/lib/supabase/queries/groups";
import { canAdmin, parseRoles, parseMemberTypes } from "@/lib/groupRoles";
export async function teamPage(id: string, section: "roster" | "invite-players" | "registration") {
  if (!z.uuid().safeParse(id).success || process.env.NEXT_PUBLIC_TEAM_ONBOARDING_ENABLED !== "true") notFound();
  const db = await createSupabaseServerClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(`/groups/${id}/${section}`)}`);
  const [g, members] = await Promise.all([getGroup(db, id), listGroupMembers(db, id)]);
  if (!g || (g.owner_id !== auth.user.id && !members.some(m => m.user_id === auth.user.id))) notFound();
  const canManage = canAdmin({ isOwner: g.owner_id === auth.user.id, roles: parseRoles(members.find(m => m.user_id === auth.user.id)?.roles) });
  if (section !== "roster" && !canManage) notFound();
  return { group: { id: g.id, name: g.name, ownerId: g.owner_id, memberTypes: parseMemberTypes(Array.isArray(g.member_types) || typeof g.member_types === "string" ? g.member_types : []), members: members.map(m => ({ id: m.id, userId: m.user_id, roles: parseRoles(m.roles), memberType: m.member_type, isPlaceholder: m.isPlaceholder, user: { id: m.user.id, name: m.user.name, profileImageUrl: m.user.profile_image_url } })) }, currentUser: { id: auth.user.id, name: auth.user.email ?? "" } };
}
