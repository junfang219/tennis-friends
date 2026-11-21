import { verifyTeamCalendarSignature, loadTeamCalendar, TeamCalendarNotFoundError } from "@/lib/teamCalendarServer";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","X-Robots-Tag":"noindex, nofollow, noarchive","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"};
export async function GET(_request:Request,context:{params:Promise<{id:string;signature:string}>}){
  try{
    const {id,signature}=await context.params;
    if(!verifyTeamCalendarSignature(id,signature)) return new Response("Team calendar not found.",{status:404,headers});
    return new Response(await loadTeamCalendar(id),{headers:{...headers,
      "Content-Type":"text/calendar; charset=utf-8","Content-Disposition":'inline; filename="team-matches.ics"',
    }});
  }catch(error){
    // Never return an empty feed on a DB failure: clients could delete events.
    return new Response("Team calendar unavailable. Please try again later.",{status:error instanceof TeamCalendarNotFoundError?404:503,headers:{...headers,"Retry-After":"300"}});
  }
}
