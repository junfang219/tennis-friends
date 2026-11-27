"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const responseSchema = z.object({
  matchId: z.uuid(),
  memberId: z.uuid(),
  userId: z.uuid().nullable(),
  status: z.string(),
  matchTypes: z.string(),
});

export async function saveMatchResponse(input: z.input<typeof responseSchema>) {
  const parsed = responseSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid match response." };

  const db = await createSupabaseServerClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return { error: "Sign in to set availability." };

  const { matchId, memberId, userId, status, matchTypes } = parsed.data;
  // Use the signed-in user's existing row-level permissions for this write.
  const { data, error } = await db.from("availabilities")
    .upsert({ event_kind: "match", match_id: matchId, member_id: memberId, user_id: userId, status, match_types: matchTypes },
      { onConflict: "match_id,member_id" })
    .select("id, member_id, user_id, status, match_types, lineup_slot, team_matches!inner(group_id)")
    .single();
  if (error) return { error: error.message };

  const { team_matches: match, ...response } = data;
  revalidatePath(`/groups/${match.group_id}`);
  return { response };
}
