import { afterEach, expect, it, vi } from "vitest";

vi.mock("./env", () => ({
  publicSupabaseUrl: () => "https://test.supabase.co",
  publishableKey: () => "test-publishable-key",
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("initializes auth and reads data even when a suspended tab holds the old auth lock", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("window", {
    location: { href: "https://example.com/groups" },
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  });
  vi.stubGlobal("document", { cookie: "", visibilityState: "hidden" });
  vi.stubGlobal("BroadcastChannel", undefined);
  // Any attempt to acquire the old mutex would hang forever, as it did in
  // Safari. Exercise our client factory and the real auth/PostgREST SDKs.
  const request = vi.fn(() => new Promise<never>(() => {}));
  vi.stubGlobal("navigator", { locks: { request } });
  const fetch = vi.fn().mockResolvedValue(new Response("[]", {
    status: 200, headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetch);
  const { createSupabaseBrowserClient } = await import("./browser");
  const client = createSupabaseBrowserClient();
  await expect(client.auth.getUser()).resolves.toMatchObject({ data: { user: null } });
  await expect(client.from("groups").select("id")).resolves.toMatchObject({ data: [], error: null });
  expect(fetch).toHaveBeenCalledOnce();
  expect(request).not.toHaveBeenCalled();
  expect(createSupabaseBrowserClient()).toBe(client);
  await client.auth.dispose();
});
