import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

const friend = z.object({ id: z.uuid(), name: z.string() });
const friendship = z.object({
  requester_id: z.uuid(), addressee_id: z.uuid(),
  requester: friend.nullable(), addressee: friend.nullable(),
});

export async function listOnboardingFriends(db: SupabaseClient<Database>, userId: string) {
  const { data, error } = await db.from("friendships").select(
    "requester_id,addressee_id,requester:profiles!friendships_requester_id_fkey(id,name),addressee:profiles!friendships_addressee_id_fkey(id,name)"
  ).eq("status", "accepted").or(`requester_id.eq.${z.uuid().parse(userId)},addressee_id.eq.${userId}`);
  if (error) throw error;
  return z.array(friendship).parse(data ?? []).flatMap(row => {
    const profile = row.requester_id === userId ? row.addressee : row.requester;
    return profile ? [profile] : [];
  });
}
