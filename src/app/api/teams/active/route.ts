import { NextResponse } from "next/server";
import { z } from "zod";
import { canAdmin, canCaptain, parseRoles } from "@/lib/groupRoles";
import { normalizeMatchStatus, RSVP } from "@/lib/rsvpStatus";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { matchTiming } from "@/lib/teamLanding";
import type { ActiveTeams } from "@/lib/teamNavigation";

const membershipsSchema = z.array(z.object({
  id: z.uuid(),
  roles: z.array(z.string()).transform(parseRoles),
  team: z.object({ id: z.uuid(), name: z.string(), owner_id: z.uuid() }),
}));

const matchesSchema = z.array(z.object({
  group_id: z.uuid(),
  match_date: z.iso.date(),
  match_time: z.string(),
  timezone: z.string().nullable(),
  scheduling_status: z.string(),
  window_end: z.iso.date().nullable(),
  availabilities: z.array(z.object({ status: z.string() })),
}));

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const query = z.literal("1").nullable().safeParse(new URL(request.url).searchParams.get("availability"));
  if (!query.success) return NextResponse.json({ error: "Invalid availability filter" }, { status: 400, headers });

  const db = await createSupabaseServerClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in to view your teams" }, { status: 401, headers });
  const viewerId = auth.user.id;

  const membership = await db.from("group_members")
    .select("id, roles, team:groups!group_members_group_id_fkey!inner(id, name, owner_id)")
    .eq("user_id", viewerId)
    .is("archived_at", null);
  const parsed = membershipsSchema.safeParse(membership.data);
  if (membership.error || !parsed.success) {
    return NextResponse.json({ error: "Could not load your teams" }, { status: 503, headers });
  }

  const teams: ActiveTeams["teams"] = parsed.data.map(({ roles, team }) => {
    const capability = { roles, isOwner: team.owner_id === viewerId };
    return {
      id: team.id,
      name: team.name,
      role: canCaptain(capability) ? "Captain" : canAdmin(capability) ? "Co-captain" : "Member",
    };
  });
  teams.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  if (query.data && teams.length > 0) {
    const now = new Date();
    // Keep week windows that started before today in consideration.
    const earliest = new Date(now.getTime() - 8 * 86_400_000).toISOString().slice(0, 10);
    const result = await db.from("team_matches")
      .select("group_id, match_date, match_time, timezone, scheduling_status, window_end, availabilities(status)")
      .in("group_id", teams.map(team => team.id))
      .in("availabilities.member_id", parsed.data.map(row => row.id))
      .or(`match_date.gte.${earliest},window_end.gte.${earliest}`);
    const matches = matchesSchema.safeParse(result.data);
    if (!result.error && matches.success) {
      const counts = new Map<string, number>();
      for (const match of matches.data) {
        const { end } = matchTiming(match);
        const response = normalizeMatchStatus(match.availabilities[0]?.status ?? "");
        if (end && end >= now && response === RSVP.NO_RESPONSE) {
          counts.set(match.group_id, (counts.get(match.group_id) ?? 0) + 1);
        }
      }
      for (const team of teams) team.pendingAvailability = counts.get(team.id) ?? 0;
    }
  }

  return NextResponse.json({ viewerId, teams } satisfies ActiveTeams, { headers });
}
