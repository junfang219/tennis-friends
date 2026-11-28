import "server-only";

import { z } from "zod";
import { canCaptain, parseRoles } from "./groupRoles";
import { parseLineupFormat } from "./leagueFormats";
import { createSupabaseServerClient } from "./supabase/server";
import { teamLanding } from "./teamLanding";

const groupSchema = z.object({
  owner_id: z.uuid(),
  group_members: z.array(z.object({
    id: z.uuid(),
    user_id: z.uuid().nullable(),
    roles: z.array(z.string()).transform(parseRoles),
    placeholder_scope: z.string().nullable(),
  })),
});

const matchesSchema = z.array(z.object({
  id: z.uuid(),
  match_date: z.iso.date(),
  match_time: z.string(),
  timezone: z.string().nullable(),
  location: z.string(),
  opponent: z.string(),
  scheduling_status: z.string(),
  window_end: z.iso.date().nullable(),
  season_id: z.uuid().nullable(),
  availabilities: z.array(z.object({
    member_id: z.uuid(),
    status: z.string(),
    lineup_slot: z.string(),
  })),
}));

export async function readTeamLanding(id: string) {
  if (!z.uuid().safeParse(id).success) return null;

  const db = await createSupabaseServerClient();
  const [{ data: auth }, groupResult] = await Promise.all([
    db.auth.getUser(),
    db.from("groups")
      .select("owner_id, group_members!group_members_group_id_fkey(id, user_id, roles, placeholder_scope)")
      .eq("id", id)
      .is("group_members.archived_at", null)
      .maybeSingle(),
  ]);
  if (!auth.user || groupResult.error || !groupResult.data) return null;

  const { owner_id: ownerId, group_members: members } = groupSchema.parse(groupResult.data);
  const userId = auth.user.id;
  const member = members.find(row => row.user_id === userId);
  if (!member && ownerId !== userId) return null;

  const now = new Date();
  // Include a preceding week for a match with a legacy week window and no
  // stored end date. The selector checks each match's end in its own timezone.
  const earliestDate = new Date(now.getTime() - 8 * 86_400_000).toISOString().slice(0, 10);
  const canSetLineup = canCaptain({ isOwner: ownerId === userId, roles: member?.roles ?? [] });
  const [matchResult, seasonResult] = await Promise.all([
    db.from("team_matches")
      .select("id, match_date, match_time, timezone, location, opponent, scheduling_status, window_end, season_id, availabilities(member_id, status, lineup_slot)")
      .eq("group_id", id)
      .or(`match_date.gte.${earliestDate},window_end.gte.${earliestDate}`),
    canSetLineup
      ? db.from("seasons").select("id, is_active, lineup_format").eq("group_id", id)
      : null,
  ]);
  if (matchResult.error) return null;

  const seasons = seasonResult?.data ?? [];
  const activeSeason = seasons.find(season => season.is_active);
  const matches = matchesSchema.parse(matchResult.data ?? []).map(match => {
    const season = seasons.find(row => row.id === match.season_id) ?? activeSeason;
    return { ...match, format: parseLineupFormat(season?.lineup_format) };
  });
  return teamLanding({
    groupId: id, ownerId, userId, members, matches, now,
    onboardingEnabled: process.env.NEXT_PUBLIC_TEAM_ONBOARDING_ENABLED === "true",
  });
}
