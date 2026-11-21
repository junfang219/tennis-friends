import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), from: vi.fn(), members: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("@/lib/onboarding/roster-data", () => ({ readTeamRoster: async () => ({ id: "33333333-3333-4333-8333-333333333333", name: "Existing team", members: await mocks.members() }) }));
import { PATCH, GET } from "./route";
const id = "33333333-3333-4333-8333-333333333333", playerId = "44444444-4444-4444-8444-444444444444";
const ctx = { params: Promise.resolve({ id }) };
const request = (body: unknown) => PATCH(new Request("https://example.com", { method: "PATCH", body: JSON.stringify(body) }), ctx);
beforeEach(() => {
  vi.clearAllMocks(); mocks.getUser.mockResolvedValue({ data: { user: { id: playerId } } }); mocks.rpc.mockResolvedValue({ data: { ok: true }, error: null }); mocks.members.mockResolvedValue([]);
});
it("forwards only a scoped confirmation, discarding spoofed identity and roster fields", async () => {
  expect((await request({ action: "confirmation", playerId, confirmed: false, acceptedBy: "spoof", players: [] })).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("patch_team_onboarding", { p_group: id, p_change: { action: "confirmation", playerId, confirmed: false } });
});
it("requires authentication before editing", async () => { mocks.getUser.mockResolvedValue({ data: { user: null } }); expect((await request({ action: "init" })).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled(); });
it("retains database manager authorization", async () => { mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } }); expect((await request({ action: "init" })).status).toBe(403); });
it.each([{ action: "unknown" }, { action: "confirmation", playerId, confirmed: "yes" }, { action: "recipients", recipients: [{ id: playerId, name: "Sam", email: "bad" }] }, { action: "registration", includeUsta: true, ustaTeamName: "Team", teamNumber: "123", deadline: "", includeRegistrationLink: true }])("rejects invalid scoped input %j", async body => { expect((await request(body)).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
it("reading an older team provides defaults without saving or deleting its roster", async () => {
  mocks.rpc.mockResolvedValue({ data: { config: null, players: [] }, error: null });
  const query = { select: vi.fn(), eq: vi.fn(), gt: vi.fn(), single: vi.fn() };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.gt.mockResolvedValue({ data: [], error: null }); query.single.mockResolvedValue({ data: { name: "Existing team" }, error: null }); mocks.from.mockReturnValue(query);
  const response = await GET(new Request("https://example.com"), ctx);
  expect(await response.json()).toMatchObject({ config: { name: "Existing team", includeUsta: false }, players: [], legacyInvitations: [] });
  expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(["read_team_onboarding"]);
});
it("legacy invite cancellation is manager-gated and scoped to this team", async () => {
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  const query = { update: vi.fn(), eq: vi.fn(), error: null }; query.update.mockReturnValue(query); query.eq.mockReturnValue(query); mocks.from.mockReturnValue(query);
  expect((await request({ action: "cancel-legacy", inviteId: playerId })).status).toBe(200);
  expect(query.eq).toHaveBeenCalledWith("group_id", id); expect(query.eq).toHaveBeenCalledWith("id", playerId);
});

it("normalizes phone-only recipients and routes them through the scoped SMS RPC",async()=>{
 expect((await request({action:"sms-recipients",recipients:[{id:playerId,name:" Sam ",phone:"(206) 555-0101",confirmedAt:"spoof",email:"spoof"}]})).status).toBe(200);
 expect(mocks.rpc).toHaveBeenCalledWith("patch_team_sms_invitations",{p_group:id,p_change:{action:"sms-recipients",recipients:[{id:playerId,name:"Sam",phone:"+12065550101"}]}});
});
it("phone edits use the scoped SMS RPC while retaining the account and email",async()=>{
 await request({action:"recipient",playerId,name:"Sam",phone:"2065550101",email:"",associatedAccountId:null});
 expect(mocks.rpc).toHaveBeenCalledWith("patch_team_sms_invitations",{p_group:id,p_change:expect.objectContaining({phone:"+12065550101",associatedAccountId:null})});
});
it("rejects invalid phone entries before the database",async()=>{expect((await request({action:"sms-recipients",recipients:[{id:playerId,name:"Sam",phone:"123"}]})).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});

it.each([
 [{code:"23505",message:"unique constraint (private phone)"},"This contact is already on the team"],
 [{code:"P0001",message:"Invitation already issued"},"An invitation has already been issued"],
 [{code:"P0001",message:"Review the pending SMS before changing its recipient"},"unresolved delivery"],
 [{code:"P0001",message:"Player already joined"},"already joined"],
])("maps save failure %j to a specific safe explanation",async(error,expected)=>{
 mocks.rpc.mockResolvedValue({data:null,error});const response=await request({action:"sms-recipients",recipients:[{id:playerId,name:"Sam",phone:"2065550101"}]});
 const body=await response.json();expect(body.error).toContain(expected);expect(body.error).not.toContain("private phone");
});
