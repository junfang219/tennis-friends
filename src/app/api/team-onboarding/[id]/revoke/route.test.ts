import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }) }));
import { POST } from "./route";
const groupId = "33333333-3333-4333-8333-333333333333", playerId = "66666666-6666-4666-8666-666666666666";
const request = () => POST(new Request("https://example.com/api/revoke", { method: "POST", body: JSON.stringify({ playerId, renew: true }) }), { params: Promise.resolve({ id: groupId }) });
beforeEach(() => { vi.clearAllMocks(); mocks.getUser.mockResolvedValue({ data: { user: { id: "55555555-5555-4555-8555-555555555555" } } }); mocks.rpc.mockResolvedValue({ data: { ok: true }, error: null }); });
it("renews the existing player rather than creating another roster entry", async () => {
  expect((await request()).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("renew_team_onboarding_invitation", { p_group: groupId, p_player: playerId });
});
it("explains unresolved delivery without offering a renewal bypass", async () => {
  mocks.rpc.mockResolvedValue({ error: { code: "55000" } });
  const response = await request();
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: expect.stringContaining("unresolved delivery") });
});
it("rejects a removed manager's renewal without changing credentials", async () => {
  mocks.rpc.mockResolvedValue({ error: { code: "42501" } });
  expect((await request()).status).toBe(403);
});
it("requires sign-in for renewal", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  expect((await request()).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled();
});
