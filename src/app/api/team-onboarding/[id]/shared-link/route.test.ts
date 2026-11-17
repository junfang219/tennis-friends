import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }) }));
import { GET, POST } from "./route";
const id = "33333333-3333-4333-8333-333333333333";
const ctx = { params: Promise.resolve({ id }) };
beforeEach(() => {
  vi.clearAllMocks(); mocks.getUser.mockResolvedValue({ data: { user: { id } } });
  mocks.rpc.mockResolvedValue({ data: { token: "a".repeat(64), enabled: true, requests: [] }, error: null });
});
it("requires sign-in to read link credentials or requests", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  expect((await GET(new Request("https://example.com"), ctx)).status).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("reads without enabling or rotating a link", async () => {
  const response = await GET(new Request("https://example.com"), ctx);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(mocks.rpc).toHaveBeenCalledWith("manage_team_join_link", { p_group: id, p_action: "read" });
});
it.each(["enable", "replace", "disable"])("passes %s to the manager-checked function", async action => {
  const response = await POST(new Request("https://example.com", { method: "POST", body: JSON.stringify({ action }) }), ctx);
  expect(response.status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("manage_team_join_link", { p_group: id, p_action: action });
});
it("rejects unsupported link mutations", async () => {
  expect((await POST(new Request("https://example.com", { method: "POST", body: '{"action":"delete-team"}' }), ctx)).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("returns an error for a non-manager", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
  expect((await GET(new Request("https://example.com"), ctx)).status).toBe(403);
});
