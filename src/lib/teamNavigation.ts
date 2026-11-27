import { z } from "zod";

export const activeTeamsSchema = z.object({
  viewerId: z.uuid(),
  teams: z.array(z.object({
    id: z.uuid(),
    name: z.string(),
    role: z.enum(["Captain", "Co-captain", "Member"]),
    pendingAvailability: z.number().int().nonnegative().optional(),
  })),
});

export type ActiveTeams = z.infer<typeof activeTeamsSchema>;

export function teamLaunchTarget(teams: Pick<ActiveTeams["teams"][number], "id">[], lastTeamId: string | null) {
  if (teams.length === 1) return `/groups/${teams[0].id}`;
  if (teams.length === 0) return null;
  return lastTeamId && teams.some(team => team.id === lastTeamId) ? `/groups/${lastTeamId}` : "/groups";
}

export function availabilityRequestLabel(count: number) {
  return count === 1 ? "1 match needs your response" : `${count} matches need your response`;
}

const lastTeamKey = (userId: string) => `tennisfriends:last-team:v1:${userId}`;

export function readLastTeam(userId: string) {
  try {
    return window.localStorage.getItem(lastTeamKey(userId));
  } catch {
    return null;
  }
}

export function rememberLastTeam(userId: string, teamId: string) {
  try {
    window.localStorage.setItem(lastTeamKey(userId), teamId);
  } catch {
    // The team page still works with storage disabled.
  }
}

export async function fetchActiveTeams(options: { availability?: boolean; signal?: AbortSignal } = {}) {
  const response = await fetch(options.availability ? "/api/teams/active?availability=1" : "/api/teams/active", {
    cache: "no-store",
    signal: options.signal,
  });
  if (!response.ok) throw new Error("Could not load your teams.");
  return activeTeamsSchema.parse(await response.json());
}
