"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const matchMemberSchema = z.object({
  matchId: z.uuid(),
  memberId: z.uuid(),
  userId: z.uuid().nullable(),
});
const responseSchema = matchMemberSchema.extend({
  status: z.string(),
  matchTypes: z.string(),
});
const lineupSchema = matchMemberSchema.extend({
  slot: z.string().max(24),
});

export async function saveMatchResponse(input: z.input<typeof responseSchema>) {
  const parsed = responseSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid match response." };

  const { status, matchTypes, ...member } = parsed.data;
  return saveMatchAvailability(member, { status, match_types: matchTypes }, "Sign in to set availability.");
}

export async function saveMatchLineupSlot(input: z.input<typeof lineupSchema>) {
  const parsed = lineupSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid lineup slot." };

  const { slot, ...member } = parsed.data;
  return saveMatchAvailability(member, { lineup_slot: slot }, "Sign in to set the lineup.");
}

async function saveMatchAvailability(
  { matchId, memberId, userId }: z.infer<typeof matchMemberSchema>,
  fields: { status: string; match_types: string } | { lineup_slot: string },
  signInError: string,
) {
  const db = await createSupabaseServerClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return { error: signInError };

  // Use the signed-in user's existing row-level permissions for this write.
  const { data, error } = await db.from("availabilities")
    .upsert({ event_kind: "match", match_id: matchId, member_id: memberId, user_id: userId, ...fields },
      { onConflict: "match_id,member_id" })
    .select("id, member_id, user_id, status, match_types, lineup_slot, team_matches!inner(group_id)")
    .single();
  if (error) return { error: error.message };

  const { team_matches: match, ...response } = data;
  revalidatePath(`/groups/${match.group_id}`);
  return { response };
}
