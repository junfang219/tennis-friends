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

it("recovers an orphaned browser auth lock through the real SDK", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("window", {
    location: { href: "https://example.com/groups" },
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  });
  vi.stubGlobal("document", { cookie: "", visibilityState: "hidden" });
  vi.stubGlobal("BroadcastChannel", undefined);
  let orphaned = true;
  const request = vi.fn((
    name: string, options: LockOptions, callback: (lock: { name: string }) => Promise<unknown>
  ) => {
    if (options.steal) orphaned = false;
    if (!orphaned) return callback({ name });
    // Model a suspended tab holding the lock until the SDK's acquisition
    // timeout aborts this waiting request. No network request can start yet.
    return new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => {
        reject(new DOMException("Timed out", "AbortError"));
      }, { once: true });
    });
  });
  vi.stubGlobal("navigator", { locks: { request } });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { createSupabaseBrowserClient } = await import("./browser");
  const client = createSupabaseBrowserClient();
  const result = client.auth.getUser();
  await vi.advanceTimersByTimeAsync(5001);
  await expect(result).resolves.toMatchObject({ data: { user: null } });
  expect(request).toHaveBeenCalledWith(
    "lock:sb-test-auth-token", expect.objectContaining({ steal: true }), expect.any(Function)
  );
  expect(createSupabaseBrowserClient()).toBe(client);
  warn.mockRestore();
});
