"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function formProposedTeam(postId: string) {
  const parsed = z.uuid().safeParse(postId);
  if (!parsed.success) return { error: "Invalid team proposal." };

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to form a team." };

  const { data, error } = await supabase.rpc("form_proposed_team", { p_post_id: parsed.data }).single();
  if (error?.code === "42501") return { error: "Only the organizer can form this team." };
  if (error || !data) return { error: "Couldn't form the team. Try again." };

  return { groupId: data.team_group_id, confirmed: data.players_confirmed };
}
