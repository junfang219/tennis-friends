import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), getClaims: vi.fn(), rpc: vi.fn(), maybeSingle: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser, getClaims: mocks.getClaims }, rpc: mocks.rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }) }) }));
import { POST, PATCH } from "./route";
const id = "33333333-3333-4333-8333-333333333333", owner = "11111111-1111-4111-8111-111111111111";
const request = (body: unknown, teamId = id) => POST(new Request("https://example.com", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: teamId }) });
beforeEach(() => { vi.clearAllMocks(); mocks.getUser.mockResolvedValue({ data: { user: { id: owner } } }); mocks.getClaims.mockResolvedValue({ data: { claims: { sub: owner } } }); mocks.maybeSingle.mockResolvedValue({ data: null, error: null }); mocks.rpc.mockResolvedValue({ data: { groupId: id }, error: null }); });
it("creates only team details, with no players or USTA requirements", async () => {
  const response = await request({ name: " Slice Society ", description: " Saturday tennis ", players: [{ name: "Spoof" }], ownerId: "spoof" });
  expect(await response.json()).toEqual({ groupId: id });
  expect(mocks.rpc).toHaveBeenCalledWith("save_team_onboarding", { p_group: id, p_config: { name: "Slice Society", description: "Saturday tennis", includeUsta: false, teamNumber: "", deadline: "" }, p_players: [] });
});
it("a retry of creation never replaces the existing roster or settings", async () => {
  mocks.maybeSingle.mockResolvedValue({ data: { id, owner_id: owner }, error: null });
  expect((await request({ name: "Old name" })).status).toBe(200); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("cannot reuse another owner's team ID", async () => {
  mocks.maybeSingle.mockResolvedValue({ data: { id, owner_id: "someone-else" }, error: null });
  expect((await request({ name: "Team" })).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("requires authentication", async () => { mocks.getUser.mockResolvedValue({ data: { user: null } }); expect((await request({ name: "Team" })).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled(); });
it.each([{ name: " " }, { name: "a".repeat(101) }, { name: "Team", description: "a".repeat(2001) }])("validates team details %j", async body => { expect((await request(body)).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
it("rejects malformed IDs before database access", async () => { expect((await request({ name: "Team" }, "bad")).status).toBe(400); expect(mocks.getUser).not.toHaveBeenCalled(); });

it("prepares the default shared link only after successfully creating a team", async () => {
  expect((await request({ name: "Team" })).status).toBe(200);
  expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(["save_team_onboarding", "manage_team_join_link"]);
  expect(mocks.rpc).toHaveBeenLastCalledWith("manage_team_join_link", { p_group: id, p_action: "enable" });
});
it("does not prepare a shared link if creating the team fails", async () => {
  mocks.rpc.mockResolvedValueOnce({ error: { code: "failed" } });
  expect((await request({ name: "Team" })).status).toBe(400); expect(mocks.rpc).toHaveBeenCalledTimes(1);
});
it("still continues to the saved team if preparing its link fails", async () => {
  mocks.rpc.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { code: "failed" } });
  expect(await (await request({ name: "Team" })).json()).toEqual({ groupId: id });
});
const edit = (body: unknown, teamId = id) => PATCH(new Request("https://example.com", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id: teamId }) });
it("Back saves only details on the same team, ignoring stale roster and registration input", async () => {
  expect(await (await edit({ name: " New name ", description: " Changed ", players: [], includeUsta: false })).json()).toEqual({ groupId: id });
  expect(mocks.rpc.mock.calls).toEqual([["update_team_setup_details", { p_group: id, p_name: "New name", p_description: "Changed" }]]);
  expect(mocks.maybeSingle).not.toHaveBeenCalled();
});
it("details edits require verified claims", async () => { mocks.getClaims.mockResolvedValue({ data: null }); expect((await edit({ name: "Team" })).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled(); });
it("returns permission denial from the details RPC", async () => { mocks.rpc.mockResolvedValue({ error: { code: "42501" } }); expect((await edit({ name: "Team" })).status).toBe(403); });
it.each([{ name: " " }, { name: "a".repeat(101) }, { name: "Team", description: "a".repeat(2001) }])("validates details edits %j", async body => { expect((await edit(body)).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
it("rejects invalid details IDs before authentication", async () => { expect((await edit({ name: "Team" }, "bad")).status).toBe(400); expect(mocks.getClaims).not.toHaveBeenCalled(); });
