import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { parseMemberTypes, parseRoles } from "@/lib/groupRoles";
const profileSchema = z.object({ id: z.uuid(), name: z.string().nullable(), profile_image_url: z.string().nullable() });
const memberSchema = z.object({ id: z.uuid(), user_id: z.uuid().nullable(), roles: z.array(z.string()), member_type: z.string(), placeholder_name: z.string().nullable(), user: z.union([profileSchema, z.array(profileSchema), z.null()]) });
export async function readTeamRoster(db: SupabaseClient<Database>, id: string) {
  const [groupResult, memberResult] = await Promise.all([
    db.from("groups").select("id,name,owner_id,member_types").eq("id", id).maybeSingle(),
    db.from("group_members")
      .select("id,user_id,roles,member_type,placeholder_name,user:profiles!group_members_user_id_fkey(id,name,profile_image_url)")
      .eq("group_id", id)
      .is("archived_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);
  if (groupResult.error || memberResult.error) throw new Error("Could not load team roster");
  if (!groupResult.data) return null;
  const g = z.object({ id: z.uuid(), name: z.string(), owner_id: z.uuid(), member_types: z.unknown() }).parse(groupResult.data);
  return { id: g.id, name: g.name, ownerId: g.owner_id, memberTypes: parseMemberTypes(Array.isArray(g.member_types) || typeof g.member_types === "string" ? g.member_types : []), members: z.array(memberSchema).parse(memberResult.data ?? []).map(m => {
    const profile = Array.isArray(m.user) ? m.user[0] : m.user;
    return { id: m.id, userId: m.user_id, roles: parseRoles(m.roles), memberType: m.member_type, isPlaceholder: m.user_id === null, user: { id: profile?.id ?? "", name: profile?.name || m.placeholder_name || "Player", profileImageUrl: profile?.profile_image_url ?? "" } };
  }) };
}
