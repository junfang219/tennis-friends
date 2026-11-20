import { beforeEach, expect, it, vi } from "vitest";
import type { z } from "zod";
import { storedOnboardingSchema } from "@/lib/onboarding/contracts";
import type { storedPlayerSchema } from "@/lib/onboarding/contracts";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), rpc: vi.fn(), from: vi.fn(), deliver: vi.fn(), config: vi.fn(), claim: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: mocks.from }),
}));
vi.mock("@/lib/onboarding/delivery", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/onboarding/delivery")>(), deliver: mocks.deliver, deliveryConfig: mocks.config,
}));
vi.mock("@/lib/onboarding/db", () => ({ onboardingDb: (client: { rpc: typeof mocks.rpc }) => ({ ...client, rpc: (name: string, args: unknown) => name === "claim_team_onboarding_delivery" ? mocks.claim(name, args) : mocks.rpc(name, args) }) }));
import { DeliveryError } from "@/lib/onboarding/delivery";
import { POST } from "./route";

const deliveryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const groupId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
type Player = z.infer<typeof storedPlayerSchema>;
function player(overrides: Partial<Player> = {}): Player {
  return {
    id: "33333333-3333-4333-8333-333333333333", group_id: groupId,
    member_id: "44444444-4444-4444-8444-444444444444", name: "Taylor",
    phone: null, email: "player@example.com", associated_account_id: null,
    associated_account_name: null, accepted_by: accountId, accepted_at: "2026-01-02T00:00:00Z",
    confirmed_at: null, sent_at: "2026-01-01T00:00:00Z", token: "a".repeat(64),
    expires_at: "2000-02-01T00:00:00Z", revoked_at: null, ...overrides,
  };
}
function setPlayers(players: Player[]) {
  mocks.rpc.mockResolvedValue({ data: {
    config: { name: "Test team", includeUsta: true, teamNumber: "1234567890", deadline: "2099-12-01" }, players,
  }, error: null });
}
function request(mode: "prepare" | "email", reminder = true) {
  return POST(new Request("https://example.com/api/send", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, reminder, batchId: "55555555-5555-4555-8555-555555555555" }),
  }), { params: Promise.resolve({ id: groupId }) });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockReturnValue({origin:"https://example.com",emailKey:"test",emailFrom:"team@example.com",smsAccount:"AC"+"a".repeat(32),smsToken:"test",smsFrom:"+12065550101"});
  mocks.getUser.mockResolvedValue({ data: { user: { id: accountId } } });
  mocks.deliver.mockResolvedValue("provider-id");
  const query = {
    select: vi.fn(), in: vi.fn(), update: vi.fn(),
    eq: vi.fn(), is: vi.fn(), insert: vi.fn(), single: vi.fn(), maybeSingle: vi.fn(), error: null,
  };
  for (const name of ["select", "in", "update", "eq", "is", "insert"] as const) {
    query[name].mockReturnValue(query);
  }
  query.single.mockResolvedValue({ data: { id: "delivery-id", accepted_by: accountId }, error: null });
  mocks.from.mockReturnValue(query);
  setPlayers([player()]);
  mocks.claim.mockImplementation(async (_name: string, args: { p_player: string; p_expected: {address:string;token:string}; p_options: {message:string;includeUsta:boolean;registration?:{ustaTeamName:string;teamNumber:string;deadline:string;includeRegistrationLink:boolean}} | null; p_reminder:boolean }) => {
    const saved = storedOnboardingSchema.parse((await mocks.rpc()).data);
    const p = saved.players.find(p => p.id === args.p_player)!;
    const settings = args.p_options ? {...saved.config,invitationMessage:args.p_options.message,includeUsta:args.p_options.includeUsta,...(args.p_options.includeUsta?args.p_options.registration:{})} : args.p_reminder || saved.config.includeUstaInInvitations !== false ? saved.config : {...saved.config,includeUsta:false};
    return {data:{status:"claimed",deliveryId,settings,recipient:{id:p.id,name:p.name,token:args.p_expected.token,address:args.p_expected.address}},error:null};
  });
});

it("emails a USTA reminder to a joined player after join-link expiry", async () => {
  const response = await request("email");
  expect(await response.json()).toMatchObject({ sent: 1, failed: 0, pending: 0 });
  expect(mocks.deliver).toHaveBeenCalledWith("email", "player@example.com",
    expect.stringContaining("Reminder: please register"), expect.any(String), deliveryId, expect.any(Object));
  expect(mocks.deliver.mock.calls[0][2]).not.toContain("Join the team:");
});

it("prepares a shareable USTA reminder for a joined player after join-link expiry", async () => {
  const response = await request("prepare");
  const result = await response.json();
  expect(result).toMatchObject({ invitations: [{ name: "Taylor", link: null, message: expect.stringContaining("Reminder: please register") }] });
  expect(result.invitations[0].message).not.toContain("Join the team:");
  expect(mocks.deliver).not.toHaveBeenCalled();
});

it.each(["prepare", "email"] as const)("keeps the join link in %s reminders for a pending player", async mode => {
  setPlayers([player({ accepted_by: null, accepted_at: null, expires_at: "2099-12-01T00:00:00Z" })]);
  mocks.from("team_onboarding_players").single.mockResolvedValue({ data: { accepted_by: null }, error: null });
  const response = await request(mode);
  expect(response.status).toBe(200);
  const body = mode === "prepare" ? (await response.json()).invitations[0].message : mocks.deliver.mock.calls[0][2];
  expect(body).toContain(`Join the team: https://example.com/team-invitations/${"a".repeat(64)}`);
});

it("omits the join link if the player accepts while a reminder is being claimed", async () => {
  setPlayers([player({ accepted_by: null, accepted_at: null, expires_at: "2099-12-01T00:00:00Z" })]);
  const response = await request("email");
  expect(await response.json()).toMatchObject({ sent: 1, failed: 0 });
  expect(mocks.deliver.mock.calls[0][2]).not.toContain("Join the team:");
});

it.each(["prepare", "email"] as const)("includes a legacy draft's description in %s invitations", async mode => {
  mocks.rpc.mockResolvedValue({ data: {
    config: { name: "Test team", description: "Saturday tennis together", includeDescription: false, includeUsta: false, teamNumber: "", deadline: "" },
    players: [player({ accepted_by: null, accepted_at: null, expires_at: "2099-12-01T00:00:00Z" })],
  }, error: null });
  const response = await request(mode, false);
  expect(response.status).toBe(200);
  if (mode === "prepare") {
    expect(await response.json()).toMatchObject({ invitations: [{ message: expect.stringContaining("Saturday tennis together") }] });
    expect(mocks.deliver).not.toHaveBeenCalled();
  } else {
    expect(await response.json()).toMatchObject({ sent: 1, failed: 0, pending: 0 });
    expect(mocks.deliver).toHaveBeenCalledWith("email", "player@example.com",
      expect.stringContaining("Saturday tennis together"), expect.any(String), deliveryId, expect.any(Object));
  }
});

it.each(["prepare", "email"] as const)("keeps expired unaccepted invitations blocked in %s mode", async mode => {
  setPlayers([player({ accepted_by: null, accepted_at: null })]);
  const response = await request(mode);
  expect(await response.json()).toMatchObject(mode === "prepare" ? { invitations: [] } : { sent: 0, failed: 1 });
  expect(mocks.deliver).not.toHaveBeenCalled();
});

it.each(["prepare", "email"] as const)("keeps revoked invitations blocked in %s mode", async mode => {
  setPlayers([player({ revoked_at: "2026-01-03T00:00:00Z" })]);
  const response = await request(mode);
  expect(await response.json()).toMatchObject(mode === "prepare" ? { invitations: [] } : { sent: 0, failed: 1 });
  expect(mocks.deliver).not.toHaveBeenCalled();
});

it("does not send USTA reminders to confirmed players", async () => {
  setPlayers([player({ confirmed_at: "2026-01-03T00:00:00Z" })]);
  const response = await request("email");
  expect(response.status).toBe(400);
  expect(mocks.deliver).not.toHaveBeenCalled();
});

it("still rejects an expired joined invitation for a normal invitation email", async () => {
  const response = await request("email", false);
  expect(await response.json()).toMatchObject({ sent: 0, failed: 1 });
  expect(mocks.deliver).not.toHaveBeenCalled();
});

it("emails registration reminders to a shared-link member using their account email", async () => {
  setPlayers([player({ email: null, associated_account_id: accountId, sent_at: null, revoked_at: null })]);
  const deliveryQuery = mocks.from("team_onboarding_deliveries");
  mocks.from.mockImplementation((table: string) => table === "profiles"
    ? { select: () => ({ in: async () => ({ data: [{ id: accountId, email: "shared@example.com" }] }) }) }
    : deliveryQuery);
  const response = await request("email", true);
  expect(await response.json()).toMatchObject({ sent: 1, failed: 0, pending: 0 });
  expect(mocks.deliver).toHaveBeenCalledWith("email", "shared@example.com",
    expect.stringContaining("Reminder: please register"), expect.any(String), deliveryId, expect.any(Object));
});

it("sends only the selected email recipients and keeps other pending players untouched", async () => {
  const selectedId = "66666666-6666-4666-8666-666666666666";
  setPlayers([player({ id: selectedId, accepted_by: null, expires_at: "2099-12-31T00:00:00Z" }), player({ id: "77777777-7777-4777-8777-777777777777", email: "other@example.com", accepted_by: null, expires_at: "2099-12-31T00:00:00Z" })]);
  const response = await POST(new Request("https://example.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "email", reminder: false, batchId: "55555555-5555-4555-8555-555555555555", playerIds: [selectedId] }) }), { params: Promise.resolve({ id: groupId }) });
  expect(await response.json()).toMatchObject({ sent: 1 }); expect(mocks.deliver).toHaveBeenCalledTimes(1);
});
it("an email instruction opt-out preserves separate USTA tracking", async () => {
  mocks.rpc.mockResolvedValue({ data: { config: { name: "Test team", includeUsta: true, includeUstaInInvitations: false, teamNumber: "0000000000", deadline: "2099-12-01" }, players: [player({ expires_at: "2099-12-31T00:00:00Z" })] }, error: null });
  await request("email", false);
  expect(mocks.deliver.mock.calls[0][2]).not.toContain("USTA team:");
  mocks.deliver.mockClear(); await request("email", true);
  expect(mocks.deliver.mock.calls[0][2]).toContain("USTA team:");
});

const smsRequest=(extra:Record<string,unknown>={})=>POST(new Request("https://example.com/api/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"sms",reminder:false,smsConsent:true,batchId:"55555555-5555-4555-8555-555555555555",...extra})}),{params:Promise.resolve({id:groupId})});
function smsPlayer(){return player({phone:"+12065550102",email:null,accepted_by:null,accepted_at:null,expires_at:"2099-12-31T00:00:00Z"});}
it("sends phone-only invitations by SMS with each personal join URL",async()=>{
 setPlayers([smsPlayer()]);expect(await(await smsRequest()).json()).toMatchObject({sent:1,failed:0,pending:0});
 expect(mocks.deliver).toHaveBeenCalledWith("sms","+12065550102",expect.stringContaining(`/team-invitations/${"a".repeat(64)}`),expect.any(String),deliveryId,expect.any(Object));
 expect(mocks.claim).toHaveBeenCalledWith("claim_team_onboarding_delivery",expect.objectContaining({p_channel:"sms",p_expected:expect.objectContaining({address:"+12065550102",token:"a".repeat(64)})}));
});
it("requires SMS consent before claiming or sending",async()=>{expect((await smsRequest({smsConsent:false})).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.deliver).not.toHaveBeenCalled();});
it("fails clearly before delivery claims when Twilio is not configured",async()=>{
 setPlayers([smsPlayer()]);mocks.config.mockReturnValue({origin:"https://example.com"});expect((await smsRequest()).status).toBe(503);expect(mocks.from("team_onboarding_deliveries").insert).not.toHaveBeenCalled();expect(mocks.deliver).not.toHaveBeenCalled();
});
it("leaves uncertain SMS attempts pending without marking failed or retrying",async()=>{
 setPlayers([smsPlayer()]);mocks.deliver.mockRejectedValueOnce(new DeliveryError("timeout","unknown"));
 expect(await(await smsRequest()).json()).toMatchObject({sent:0,failed:0,pending:1});expect(mocks.deliver).toHaveBeenCalledTimes(1);expect(mocks.from("team_onboarding_deliveries").update).not.toHaveBeenCalled();
});
it("records explicit SMS rejection as failed",async()=>{
 setPlayers([smsPlayer()]);mocks.deliver.mockRejectedValueOnce(new DeliveryError("rejected","failed"));expect(await(await smsRequest()).json()).toMatchObject({sent:0,failed:1,pending:0});expect(mocks.from("team_onboarding_deliveries").update).toHaveBeenCalledWith({status:"failed"});
});
it.each(["sent","sending","failed"])("duplicate SMS claim in %s state never calls the provider again",async status=>{
 setPlayers([smsPlayer()]);mocks.claim.mockResolvedValue({data:{status},error:null});
 expect(await(await smsRequest()).json()).toMatchObject({sent:status==="sent"?1:0,pending:status==="sending"?1:0,failed:status==="failed"?1:0});expect(mocks.deliver).not.toHaveBeenCalled();
});
it("a pending SMS in another batch also blocks sending",async()=>{
 setPlayers([smsPlayer()]);mocks.claim.mockResolvedValue({data:{status:"sending"},error:null});expect(await(await smsRequest()).json()).toMatchObject({pending:1});expect(mocks.deliver).not.toHaveBeenCalled();
});
it.each([{phone:null},{phone:"invalid"},{accepted_by:accountId},{revoked_at:"2026-11-17T00:00:00Z"}])("does not text an unavailable or invalid SMS recipient %j",async overrides=>{
 setPlayers([{...smsPlayer(),...overrides}]);await smsRequest();expect(mocks.deliver).not.toHaveBeenCalled();
});
it("does not treat a foreign selected player ID as permission to send",async()=>{setPlayers([smsPlayer()]);expect((await smsRequest({playerIds:["99999999-9999-4999-8999-999999999999"]})).status).toBe(400);expect(mocks.deliver).not.toHaveBeenCalled();});
it("does not send SMS USTA reminders under invitation consent",async()=>{expect((await smsRequest({reminder:true})).status).toBe(400);expect(mocks.deliver).not.toHaveBeenCalled();});
it("returns the delivery limit when all SMS attempts in the request are new and blocked", async () => {
  setPlayers([smsPlayer()]);
  mocks.claim.mockResolvedValue({ data: { status: "rate_limited" }, error: null });
  expect((await smsRequest()).status).toBe(429);
  expect(mocks.deliver).not.toHaveBeenCalled();
});

it("reports prior attempts when a new SMS in a retry is rate limited", async () => {
  const first = smsPlayer();
  const second = { ...first, id: "66666666-6666-4666-8666-666666666666", phone: "+12065550103" };
  setPlayers([first, second]);
  mocks.claim.mockResolvedValueOnce({ data: { status: "sent" }, error: null })
    .mockResolvedValueOnce({ data: { status: "rate_limited" }, error: null });
  const response = await smsRequest();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ sent: 1, failed: 1, pending: 0, message: expect.stringContaining("delivery limit") });
  expect(mocks.deliver).not.toHaveBeenCalled();
});
it("rejects an oversized SMS before creating a delivery",async()=>{mocks.rpc.mockResolvedValue({data:{config:{name:"Team",description:"a".repeat(2000),includeUsta:false,teamNumber:"",deadline:""},players:[smsPlayer()]},error:null});expect((await smsRequest()).status).toBe(400);expect(mocks.deliver).not.toHaveBeenCalled();});

it("does not text a localhost invitation URL that the receiving phone cannot open",async()=>{setPlayers([smsPlayer()]);mocks.config.mockReturnValue({...mocks.config(),origin:"http://127.0.0.1:3110"});expect((await smsRequest()).status).toBe(503);expect(mocks.deliver).not.toHaveBeenCalled();});

it.each(["sms", "email"] as const)("includes saved USTA details in the actual %s provider message", async mode => {
  mocks.rpc.mockResolvedValue({ data: { config: { name: "Test team", includeUsta: true, includeUstaInInvitations: true, ustaTeamName: "TEST ONLY USTA", teamNumber: "0000000000", deadline: "2099-12-01", includeRegistrationLink: true }, players: [{ ...smsPlayer(), email: "player@example.com" }] }, error: null });
  if (mode === "sms") await smsRequest(); else await request("email", false);
  const message = mocks.deliver.mock.calls[0][2] as string;
  expect(message).toContain("USTA team: TEST ONLY USTA"); expect(message).toContain("Team number: 0000000000");
  expect(message).toContain("Register by: December 1, 2099"); expect(message).toContain("https://tennislink.usta.com/");
  expect(message).toContain(`/team-invitations/${"a".repeat(64)}`);
});

it("never sends when a recipient changes between the read and atomic claim", async () => {
  setPlayers([smsPlayer()]); mocks.claim.mockResolvedValue({data:{status:"changed"},error:null});
  expect(await(await smsRequest()).json()).toMatchObject({sent:0,failed:1,pending:0,message:expect.stringContaining("recipient changed")});
  expect(mocks.deliver).not.toHaveBeenCalled();
});
it("uses only the recipient and settings captured by the claim", async () => {
  setPlayers([smsPlayer()]);
  mocks.claim.mockResolvedValue({data:{status:"claimed",deliveryId,recipient:{id:smsPlayer().id,name:"Snapshot",address:"+12065550119",token:"b".repeat(64)},settings:{name:"Captured team",includeUsta:false,teamNumber:"",deadline:"",invitationMessage:"Captured message"}},error:null});
  await smsRequest();expect(mocks.deliver).toHaveBeenCalledWith("sms","+12065550119",expect.stringContaining(`/team-invitations/${"b".repeat(64)}`),"Invitation to Captured team",deliveryId,expect.any(Object));
  expect(mocks.deliver.mock.calls[0][2]).toContain("Captured message");
});
it("rejects a stale form recipient before even creating a delivery claim", async () => {
  setPlayers([smsPlayer()]);
  const p=smsPlayer(); const response=await smsRequest({recipients:[{id:p.id,token:p.token,phone:"+12065550111",email:p.email,associatedAccountId:p.associated_account_id}]});
  expect(response.status).toBe(409);expect(mocks.claim).not.toHaveBeenCalled();expect(mocks.deliver).not.toHaveBeenCalled();
});
it("keeps the first tab's USTA opt-out when another tab changed the saved settings", async () => {
  setPlayers([smsPlayer()]);
  await smsRequest({invitation:{message:"First tab message",includeUsta:false}});
  expect(mocks.claim).toHaveBeenCalledWith("claim_team_onboarding_delivery",expect.objectContaining({p_options:{message:"First tab message",includeUsta:false}}));
  expect(mocks.deliver.mock.calls[0][2]).toContain("First tab message");expect(mocks.deliver.mock.calls[0][2]).not.toContain("USTA team:");
});
it("uses the selected USTA number instead of a different tab's saved number", async () => {
  setPlayers([smsPlayer()]);
  await smsRequest({invitation:{message:"My invitation",includeUsta:true,registration:{ustaTeamName:"My USTA team",teamNumber:"0000000000",deadline:"2099-12-04",includeRegistrationLink:false}}});
  expect(mocks.deliver.mock.calls[0][2]).toContain("Team number: 0000000000");expect(mocks.deliver.mock.calls[0][2]).not.toContain("1234567890");expect(mocks.deliver.mock.calls[0][2]).not.toContain("https://tennislink.usta.com/");
});
it("rechecks manager authorization when claiming, even after a successful read", async () => {
  setPlayers([smsPlayer()]);mocks.claim.mockResolvedValue({data:null,error:{code:"42501"}});
  expect((await smsRequest()).status).toBe(403);expect(mocks.deliver).not.toHaveBeenCalled();
});
it("does not send if the claimed snapshot response is malformed", async () => {
  setPlayers([smsPlayer()]);mocks.claim.mockResolvedValue({data:{status:"claimed",deliveryId},error:null});
  expect(await(await smsRequest()).json()).toMatchObject({pending:1,sent:0});expect(mocks.deliver).not.toHaveBeenCalled();
});
it("validates request-scoped USTA options before touching the database", async () => {
  expect((await smsRequest({invitation:{message:"Hi",includeUsta:true}})).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();
});

it("uses a public SMS-only origin for texts from the local app", async () => {
 setPlayers([smsPlayer()]);mocks.config.mockReturnValue({...mocks.config(),origin:"http://127.0.0.1:3110",smsOrigin:"https://mytennisfriends.com"});
 expect((await smsRequest()).status).toBe(200);expect(mocks.deliver.mock.calls[0][2]).toContain("https://mytennisfriends.com/team-invitations/");expect(mocks.deliver.mock.calls[0][2]).not.toContain("127.0.0.1");
});
