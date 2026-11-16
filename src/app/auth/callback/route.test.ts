import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ exchange: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { exchangeCodeForSession: mocks.exchange } }) }));
import { GET } from "./route";
beforeEach(() => { vi.stubEnv("NODE_ENV", "development"); mocks.exchange.mockReset(); });
it("keeps the browser's loopback origin", async () => {
 const response = await GET(new NextRequest("http://localhost:3110/auth/callback?next=%2Fgroups", { headers: { host: "127.0.0.1:3110" } }));
 expect(response.headers.get("location")).toBe("http://127.0.0.1:3110/groups");
});
it("preserves the invitation destination after exchange failure", async () => {
 mocks.exchange.mockResolvedValue({ error: { message: "fetch failed" } });
 const response = await GET(new NextRequest("http://localhost:3110/auth/callback?code=test&next=%2Fteam-invitations%2Ftest", { headers: { host: "127.0.0.1:3110" } }));
 const location = new URL(response.headers.get("location")!);
 expect(location.origin).toBe("http://127.0.0.1:3110");
 expect(location.searchParams.get("next")).toBe("/team-invitations/test");
 expect(location.searchParams.get("error")).toContain("authentication service");
});
it("rejects external redirect destinations", async () => {
 const response = await GET(new NextRequest("http://localhost:3110/auth/callback?next=https%3A%2F%2Fexample.com"));
 expect(response.headers.get("location")).toBe("http://localhost:3110/");
});
