import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({admin:vi.fn(), from:vi.fn(), user:vi.fn(), rpc:vi.fn()}));
vi.mock("./supabase/admin",()=>({createSupabaseAdminClient:mocks.admin}));
vi.mock("./supabase/server",()=>({createSupabaseServerClient:async()=>({from:mocks.from,auth:{getUser:mocks.user},rpc:mocks.rpc})}));
import { teamCalendarPath } from "./teamCalendarServer";
import { GET } from "@/app/calendar/teams/[id]/[signature]/matches.ics/route";
import { POST } from "@/app/api/calendar/teams/[id]/route";
import { createTeamCalendarLink, buildGoogleTeamCalendarUrl } from "./teamCalendar";
const id="5f6ac25b-5e13-4a11-969d-994c668b54bf";
const other="5f6ac25b-5e13-4a11-969d-994c668b54be";
const match={id,match_date:"2026-09-11",match_time:"21:15",timezone:"America/Los_Angeles",location:"Free text court",opponent:"Visitors"};
let rows=[match,{...match,id:other,match_date:"2026-12-11"}];
let fail=false;
let missing=false;
const filters: unknown[][]=[];
function query(table:string){
 const q={select:vi.fn(()=>q),eq:vi.fn((...args:unknown[])=>{filters.push([table,...args]);return q;}),order:vi.fn(()=>q),
  maybeSingle:vi.fn(async()=>({data:missing?null:{name:"Slice Society"},error:fail?{}:null})),
  range:vi.fn(async(start:number,end:number)=>({data:rows.slice(start,end+1),error:fail?{}:null}))};return q;
}
const get=(path=teamCalendarPath(id))=>GET(new Request(`https://mytennisfriends.com${path}`),{params:Promise.resolve({id:path.split("/")[3],signature:path.split("/")[4]})});
const post=(body:unknown={},origin="https://mytennisfriends.com")=>POST(new Request(`https://mytennisfriends.com/api/calendar/teams/${id}`,{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(body)}),{params:Promise.resolve({id})});
beforeEach(()=>{
 vi.stubEnv("CALENDAR_LINK_SECRET","ab".repeat(32));vi.stubEnv("CALENDAR_LINK_BASE_URL","https://mytennisfriends.com");
 filters.length=0;fail=false;missing=false;rows=[match,{...match,id:other,match_date:"2026-12-11"}];
 mocks.admin.mockReset().mockReturnValue({from:query});
 mocks.user.mockResolvedValue({data:{user:{id:"member"}}});
 mocks.from.mockImplementation(()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id:"membership"},error:null})};return q;});
 mocks.rpc.mockReset();
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it("issues one stable URL per team across repeated requests and rejects nonmembers",async()=>{
 const first=await (await post()).json();expect(first.path).toBe(teamCalendarPath(id));expect((await (await post()).json()).path).toBe(first.path);
 expect(teamCalendarPath(other)).not.toBe(first.path);expect(first.baseUrl).toBe("https://mytennisfriends.com");
 mocks.user.mockResolvedValue({data:{user:null}});expect((await post()).status).toBe(401);
 expect((await post({},"https://evil.example")).status).toBe(403);
 mocks.user.mockResolvedValue({data:{user:{id:"outsider"}}});
 mocks.from.mockImplementation(()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:null,error:null})};return q;});
 expect((await post()).status).toBe(403);
});
it("allows only a guest whose RSVP grants this team match access",async()=>{
 mocks.user.mockResolvedValue({data:{user:null}});
 mocks.rpc.mockResolvedValue({data:{group:{id},matches:[{id}]},error:null});expect((await post({guestToken:"valid"})).status).toBe(200);
 mocks.rpc.mockResolvedValue({data:{group:{id:other},matches:[{id}]},error:null});expect((await post({guestToken:"valid"})).status).toBe(403);
 mocks.rpc.mockResolvedValue({data:{group:{id},matches:[]},error:null});expect((await post({guestToken:"practice-only"})).status).toBe(403);
});
it("serves multiple matches in one named calendar with stable UIDs and correct DST",async()=>{
 const result=await get();expect(result.status).toBe(200);expect(result.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
 const body=await result.text();expect(body.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(2);
 expect(body).toContain("X-WR-CALNAME:Slice Society — Matches");expect(body).toContain("DTSTART:20260912T041500Z");expect(body).toContain("DTSTART:20261212T051500Z");
 expect(body).toContain(`UID:match-${id}@tennisfriend`);expect(body).toContain("LOCATION:Free text court");
 expect(filters).toContainEqual(["team_matches","group_id",id]);expect(filters).toContainEqual(["team_matches","scheduling_status","fixed"]);
 rows=[{...match,match_time:"20:00"}];const changed=await (await get()).text();
 expect(changed).toContain(`UID:match-${id}@tennisfriend`);expect(changed).toContain("DTSTART:20260912T030000Z");expect(changed).not.toContain(`UID:match-${other}`);
});
it("checks signatures before database access and preserves errors rather than clearing calendars",async()=>{
 const path=teamCalendarPath(id);expect((await get(path.replace(id,other))).status).toBe(404);expect(mocks.admin).not.toHaveBeenCalled();
 fail=true;expect((await get()).status).toBe(503);fail=false;missing=true;expect((await get()).status).toBe(404);
 missing=false;rows=[];const empty=await get();expect(empty.status).toBe(200);expect(await empty.text()).not.toContain("BEGIN:VEVENT");
});
it("paginates schedules beyond the database page limit",async()=>{
 rows=Array.from({length:501},()=>match);expect((await (await get()).text()).match(/BEGIN:VEVENT/g)).toHaveLength(501);
});
it("uses the public domain from localhost and handles authorization errors",async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({path:teamCalendarPath(id),baseUrl:"https://mytennisfriends.com"}));vi.stubGlobal("fetch",fetcher);
 expect(await createTeamCalendarLink(id)).toBe(`https://mytennisfriends.com${teamCalendarPath(id)}`);
 fetcher.mockResolvedValue(new Response(null,{status:403}));await expect(createTeamCalendarLink(id)).rejects.toThrow("team members");
});

it("opens Google subscription setup with the whole team's stable feed, not an event template",()=>{
 const feed=`https://mytennisfriends.com${teamCalendarPath(id)}`;
 const url=new URL(buildGoogleTeamCalendarUrl(feed));
 expect(url.origin).toBe("https://calendar.google.com");
 expect(url.searchParams.get("cid")).toBe(feed.replace(/^https:/, "webcal:"));
 expect(url.searchParams.has("dates")).toBe(false);
 expect(()=>buildGoogleTeamCalendarUrl("javascript:alert(1)")).toThrow();
});
