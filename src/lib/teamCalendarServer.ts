import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { CalendarLinkConfigurationError } from "./calendarLinkToken";
import { normalizeCalendarEvent, buildNamedCalendarIcs } from "./calendarExport";
import { createSupabaseAdminClient } from "./supabase/admin";

export const teamIdSchema = z.uuid().transform((id) => id.toLowerCase());

// A stable, scoped capability: the same team always gets the same URL across
// members, individual match cards, and subsequent requests. No per-event token.
function signatureFor(id: string): string {
  const parsed = z.string().regex(/^[a-fA-F0-9]{64}$/).safeParse(process.env.CALENDAR_LINK_SECRET);
  if (!parsed.success) throw new CalendarLinkConfigurationError("Calendar key unavailable");
  return createHmac("sha256", Buffer.from(parsed.data,"hex"))
    .update(`TennisFriend team matches v1:${teamIdSchema.parse(id)}`).digest("base64url");
}
export function teamCalendarPath(id: string): string {
  const teamId = teamIdSchema.parse(id);
  return `/calendar/teams/${teamId}/${signatureFor(teamId)}/matches.ics`;
}
export function verifyTeamCalendarSignature(id: string, signature: string): boolean {
  if (!teamIdSchema.safeParse(id).success || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(signatureFor(id)));
}

const groupSchema = z.object({ name:z.string().min(1) });
const matchSchema = z.object({
  id:z.uuid(), match_date:z.string(), match_time:z.string(), timezone:z.string().nullable(),
  location:z.string(), opponent:z.string(),
});
export class TeamCalendarNotFoundError extends Error {}

/** Only call after validating the team-scoped signature. The admin read is
 * explicitly restricted to this team and public schedule fields; no roster,
 * player contacts, lineup data, or private match notes leave this endpoint. */
export async function loadTeamCalendar(id: string): Promise<string> {
  const teamId = teamIdSchema.parse(id);
  const admin = createSupabaseAdminClient();
  const {data:group,error:groupError} = await admin.from("groups").select("name").eq("id",teamId).maybeSingle();
  if (groupError) throw new Error("Unable to load team");
  if (!group) throw new TeamCalendarNotFoundError("Team not found");
  const {name} = groupSchema.parse(group);
  const entries = [];
  const pageSize = 500;
  // Fetch every scheduled match, including history and all seasons, without
  // silently hitting Supabase's row limit. Window/TBD polls aren't real dates.
  for (let offset=0;;offset+=pageSize) {
    const {data,error} = await admin.from("team_matches")
      .select("id,match_date,match_time,timezone,location,opponent")
      .eq("group_id",teamId).eq("scheduling_status","fixed")
      .order("id").range(offset,offset+pageSize-1);
    if (error) throw new Error("Unable to load team schedule");
    const rows = z.array(matchSchema).parse(data);
    for (const match of rows) {
      entries.push({id:`match-${match.id}`,payload:normalizeCalendarEvent({
        id:`match-${match.id}`, title:`${name} vs ${match.opponent || "TBD"}`,
        date:match.match_date, time:match.match_time,
        timezone:match.timezone || "America/Los_Angeles", location:match.location,
      })});
    }
    if (rows.length<pageSize) break;
    if (entries.length>=10000) throw new Error("Team schedule exceeds feed limit");
  }
  return buildNamedCalendarIcs(`${name} — Matches`,entries);
}
