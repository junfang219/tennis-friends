import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({createSupabaseServerClient: async () => ({ auth:{getUser:mocks.user},rpc:mocks.rpc })}));
import { POST } from "@/app/api/calendar/links/route";
import { GET } from "@/app/calendar/shared/[token]/event.ics/route";
import { normalizeCalendarEvent } from "./calendarExport";
import { sealCalendarLink } from "./calendarLinkToken";
const body = {id:"match-test",payload:normalizeCalendarEvent({id:"match-test",title:"Doubles, tennis",date:"2026-09-26",time:"12:30",timezone:"America/Los_Angeles",description:"line one\r\nline two"})};
const request = (value: unknown = body, origin = "https://mytennisfriends.com") => new Request("https://mytennisfriends.com/api/calendar/links", {method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(value)});
const fetchCalendar = (token: string) => GET(new Request("https://mytennisfriends.com/calendar"), {params:Promise.resolve({token})});
beforeEach(() => { vi.stubEnv("CALENDAR_LINK_SECRET","ef".repeat(32)); mocks.user.mockResolvedValue({data:{user:{id:"user-test"}}}); mocks.rpc.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
describe("hosted calendar HTTP flow", () => {
 it("returns the configured public host for phone testing", async () => {
  vi.stubEnv("CALENDAR_LINK_BASE_URL","https://mytennisfriends.com");
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect((await response.json()).baseUrl).toBe("https://mytennisfriends.com");
  vi.stubEnv("CALENDAR_LINK_BASE_URL","javascript:alert(1)");
  expect((await POST(request())).status).toBe(503);
 });
 it("creates an authenticated link that opens anonymously with calendar headers", async () => {
  const response = await POST(request()); expect(response.status).toBe(200);
  const link = await response.json();
  mocks.user.mockClear();
  const calendar = await fetchCalendar(link.path.split("/")[3]);
  expect(calendar.status).toBe(200);
  expect(mocks.user).not.toHaveBeenCalled();
  expect(calendar.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
  expect(calendar.headers.get("content-disposition")).toBe('inline; filename="tennis-event.ics"');
  expect(calendar.headers.get("cache-control")).toContain("no-store");
  const ics = await calendar.text();
  expect(ics).toContain("DTSTART:20260926T193000Z");
  expect(ics).toContain("SUMMARY:Doubles\\, tennis");
  expect(ics).toContain("DESCRIPTION:line one\\nline two");
  expect(ics).toContain("UID:match-test@tennisfriend");
 });
 it("preserves all-day dates", async () => {
  const payload = normalizeCalendarEvent({id:"day",title:"All day",date:"2026-12-31"});
  const link = sealCalendarLink({id:"day",payload});
  const ics = await (await fetchCalendar(link.path.split("/")[3])).text();
  expect(ics).toContain("DTSTART;VALUE=DATE:20261231");
  expect(ics).toContain("DTEND;VALUE=DATE:20270101");
 });
 it("rejects unauthenticated creation, cross-origin requests, and malformed data", async () => {
  expect((await POST(request(body,"https://evil.example"))).status).toBe(403);
  expect((await POST(request({bad:true}))).status).toBe(400);
  mocks.user.mockResolvedValue({data:{user:null}});
  expect((await POST(request())).status).toBe(401);
 });
 it("accepts guests only with access to the referenced event", async () => {
  mocks.user.mockResolvedValue({data:{user:null}});
  mocks.rpc.mockResolvedValue({data:{matches:[{id:"test"}],practices:[]},error:null});
  expect((await POST(request({...body,guestToken:"valid-token"}))).status).toBe(200);
  expect((await POST(request({...body,id:"match-other",guestToken:"valid-token"}))).status).toBe(403);
  mocks.rpc.mockResolvedValue({data:null,error:{message:"invalid"}});
  expect((await POST(request({...body,guestToken:"revoked"}))).status).toBe(403);
 });
 it("handles expiry, corruption, missing config, and oversized requests", async () => {
  const expired = sealCalendarLink(body,1000);
  expect((await fetchCalendar(expired.path.split("/")[3])).status).toBe(410);
  expect((await fetchCalendar("broken")).status).toBe(404);
  expect((await POST(request({...body,payload:{...body.payload,notes:"x".repeat(17000)}}))).status).toBe(413);
  vi.stubEnv("CALENDAR_LINK_SECRET","");
  expect((await POST(request())).status).toBe(503);
 });
});
