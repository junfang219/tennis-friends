import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { teamCalendarRequestSchema } from "@/lib/teamCalendar";
import { teamIdSchema, teamCalendarPath } from "@/lib/teamCalendarServer";
import { calendarLinkBaseUrl, CalendarLinkConfigurationError } from "@/lib/calendarLinkToken";
const json = (body:object,status=200) => Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
const guestSchema = z.object({group:z.object({id:z.uuid()}),matches:z.array(z.object({id:z.uuid()}))});
export const runtime = "nodejs";

export async function POST(request:Request, context:{params:Promise<{id:string}>}) {
  if (request.headers.get("origin")!==new URL(request.url).origin) return json({error:"Invalid origin"},403);
  const id = teamIdSchema.safeParse((await context.params).id);
  if (!id.success) return json({error:"Invalid team"},400);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({error:"Expected JSON"},415);
  // This request contains at most one small RSVP capability, never event data.
  const reader = request.body?.getReader();
  if (!reader) return json({error:"Missing request"},400);
  let bytes=0; const chunks:Uint8Array[]=[];
  try {
    for (;;) {
      const {value,done}=await reader.read();if(done) break;
      bytes+=value.byteLength;if(bytes>1024){await reader.cancel();return json({error:"Request too large"},413);}
      chunks.push(value);
    }
    const body=teamCalendarRequestSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!body.success) return json({error:"Invalid request"},400);
    const supabase=await createSupabaseServerClient();
    const {data:{user}}=await supabase.auth.getUser();
    let authorized=false;
    if(user){
      const [member,group]=await Promise.all([
        supabase.from("group_members").select("id").eq("group_id",id.data).eq("user_id",user.id).maybeSingle(),
        supabase.from("groups").select("owner_id").eq("id",id.data).maybeSingle(),
      ]);
      if(member.error || group.error) return json({error:"Unable to verify team access"},503);
      authorized=!!member.data || group.data?.owner_id===user.id;
    }
    if(!authorized && body.data.guestToken){
      const {data,error}=await supabase.rpc("guest_roster_view",{p_token:body.data.guestToken});
      const view=guestSchema.safeParse(data);
      // Nonempty matches establishes match scope (practice/poll-only guests
      // receive an empty match list). The RSVP token never enters the feed URL.
      authorized=!error && view.success && view.data.group.id===id.data && view.data.matches.length>0;
    }
    if(!authorized) return json({error:"Team access required"},user||body.data.guestToken?403:401);
    return json({path:teamCalendarPath(id.data),baseUrl:calendarLinkBaseUrl()});
  }catch(error){
    if(error instanceof SyntaxError) return json({error:"Invalid JSON"},400);
    return json({error:"Team calendar unavailable"},error instanceof CalendarLinkConfigurationError?503:500);
  }
}
