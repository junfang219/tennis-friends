import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }) }));
import { GET, POST } from "./route";
const token = "a".repeat(64);
const groupId = "33333333-3333-4333-8333-333333333333";
const info = { groupId, name: "Test Team", description: "Test", status: "pending" };
const ctx = (value = token) => ({ params: Promise.resolve({ token: value }) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.getUser.mockResolvedValue({ data: { user: { id: groupId } } });
  mocks.rpc.mockResolvedValue({ data: info, error: null });
});
it("allows a public preview and prevents caching account-specific status", async () => {
  const response = await GET(new Request("https://example.com"), ctx());
  expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(mocks.rpc).toHaveBeenCalledWith("view_team_join_link", { p_token: token });
});
it("requires sign-in before creating a request", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  expect((await POST(new Request("https://example.com"), ctx())).status).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("requests access for the authenticated account without accepting client identity or roles", async () => {
  const response = await POST(new Request("https://example.com", { method: "POST", body: JSON.stringify({ userId: "forged", roles: ["manager"] }) }), ctx());
  expect(await response.json()).toMatchObject({ status: "pending" });
  expect(mocks.rpc).toHaveBeenCalledWith("request_team_join", { p_token: token });
});
it("rejects malformed tokens without reaching the database", async () => {
  expect((await POST(new Request("https://example.com"), ctx("bad"))).status).toBe(404);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("returns unavailable for disabled, replaced, or missing links", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  expect((await GET(new Request("https://example.com"), ctx())).status).toBe(404);
});
