import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }) }));
import { POST } from "./route";
const id = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const playerId = "55555555-5555-4555-8555-555555555555";
function request(body: unknown, groupId = id) {
  return POST(new Request("https://example.com", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: groupId }) });
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.getUser.mockResolvedValue({ data: { user: { id } } });
  mocks.rpc.mockResolvedValue({ data: { status: "approved" }, error: null });
});
it("requires sign-in before reviewing requests", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  expect((await request({ requestId, decision: "approve" })).status).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each([{}, { requestId, decision: "other" }, { requestId, decision: "approve", playerId: "bad" }])("validates review input %j", async body => {
  expect((await request(body)).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("rejects an invalid team ID", async () => {
  expect((await request({ requestId, decision: "approve" }, "bad")).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("passes only the decision and chosen roster entry to the permission-checked function", async () => {
  expect((await request({ requestId, decision: "approve", playerId, userId: "forged", roles: ["manager"] })).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("review_team_join_request", { p_group: id, p_request: requestId, p_decision: "approve", p_player: playerId });
});
it("does not report approval when the database denies manager access", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
  expect((await request({ requestId, decision: "approve" })).status).toBe(403);
});
