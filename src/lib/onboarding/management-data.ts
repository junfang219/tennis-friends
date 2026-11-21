import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { onboardingDb } from "./db";
import { readTeamRoster } from "./roster-data";
import { teamManagementStateSchema } from "./management";
import { smsReadiness } from "./delivery-config";

export class TeamManagementReadError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

// Callers authenticate once. The read RPC independently requires current manager
// access. Share the roster promise with the page's access check; never cache users.
export async function readTeamManagement(db: SupabaseClient<Database>, id: string, roster = readTeamRoster(db, id)) {
  const [group, saved, legacy] = await Promise.all([
    roster,
    onboardingDb(db).rpc("read_team_onboarding", { p_group: id }),
    db.from("group_invites").select("id,email,token,roles,member_type").eq("group_id", id).eq("status", "pending").gt("expires_at", new Date().toISOString()),
  ]);
  if (saved.error) throw new TeamManagementReadError("Cannot load onboarding. Confirm the database migration is installed and you manage this team.", 403);
  if (!group) throw new TeamManagementReadError("Team not found", 404);
  if (legacy.error) throw new TeamManagementReadError("Cannot load team invitations", 500);
  const raw = z.object({ config: z.record(z.string(), z.unknown()).nullable(), players: z.array(z.unknown()) }).safeParse(saved.data);
  if (!raw.success) throw new TeamManagementReadError("Cannot load team invitations", 500);
  const config = raw.data.config ?? { description: "", includeUsta: false, teamNumber: "", deadline: "" };
  const parsed = teamManagementStateSchema.safeParse({
    config: { ...config, name: group.name }, players: raw.data.players,
    delivery: { sms: smsReadiness() },
    members: group.members.map(m => ({ id: m.id, userId: m.userId, name: m.user.name })),
    legacyInvitations: (legacy.data ?? []).map(i => ({ id: i.id, email: i.email, token: i.token, roles: i.roles, memberType: i.member_type })),
  });
  if (!parsed.success) throw new TeamManagementReadError("Cannot load team invitations", 500);
  return parsed.data;
}
