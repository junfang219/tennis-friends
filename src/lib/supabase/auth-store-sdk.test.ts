import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";

const state = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("./browser", () => ({ createSupabaseBrowserClient: () => state.client }));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => "web" } }));
vi.mock("react", () => ({
  useSyncExternalStore: <T>(subscribe: (cb: () => void) => () => void, getSnapshot: () => T) => {
    subscribe(() => {});
    return getSnapshot();
  },
}));

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}
const user: User = {
  id: "11111111-1111-4111-8111-111111111111", aud: "authenticated",
  app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z",
};
const otherUser: User = { ...user, id: "22222222-2222-4222-8222-222222222222" };
function sessionFor(account: User): Session {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const token = [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: account.id, exp: expiresAt })).toString("base64url"),
    "test-only-signature",
  ].join(".");
  return {
    access_token: token, refresh_token: "test-only-refresh", token_type: "bearer",
    expires_in: 3600, expires_at: expiresAt, user: account,
  };
}
function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal("window", {
    location: { href: "https://example.com/groups", pathname: "/groups" },
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  });
  vi.stubGlobal("document", { visibilityState: "hidden" });
  vi.stubGlobal("BroadcastChannel", undefined);
});
afterEach(async () => {
  await state.client?.auth.dispose();
  state.client = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(["sign-out", "account switch"] as const)("keeps the real SDK's %s state after an older user response arrives", async action => {
  const started = deferred<void>();
  const response = deferred<Response>();
  const storageKey = `auth-race-${action}`;
  const storage = new Map<string, string>([[storageKey, JSON.stringify(sessionFor(user))]]);
  const client = createClient("https://test.supabase.co", "test-only-key", {
    auth: {
      storageKey, autoRefreshToken: false, detectSessionInUrl: false,
      storage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => { storage.set(key, value); },
        removeItem: key => { storage.delete(key); },
      },
    },
    global: {
      fetch: async input => {
        const url = new URL(String(input));
        if (url.pathname === "/auth/v1/user") {
          started.resolve();
          return response.promise;
        }
        if (url.pathname === "/auth/v1/logout") return new Response(null, { status: 204 });
        if (url.pathname === "/auth/v1/token") return json(sessionFor(otherUser));
        if (url.pathname === "/rest/v1/auth_debug_events") return json([]);
        throw new Error(`Unexpected test request: ${url.pathname}`);
      },
    },
  });
  state.client = client;
  await client.auth.initialize();
  const store = await import("./auth-store");
  store.useAuthSnapshot();
  await started.promise;

  await expect(client.auth.signOut()).resolves.toEqual({ error: null });
  if (action === "account switch") {
    const signedIn = await client.auth.signInWithPassword({ email: "other@example.com", password: "test-only" });
    expect(signedIn.error).toBeNull();
  }
  const expectedUser = action === "sign-out" ? null : otherUser;
  expect(store.useAuthSnapshot()).toEqual({ user: expectedUser, loaded: true });

  // Supabase still resolves this request for the old JWT. The store must
  // discard it without restoring the previous account in hooks or queries.
  response.resolve(json(user));
  await vi.advanceTimersByTimeAsync(0);
  expect(store.useAuthSnapshot()).toEqual({ user: expectedUser, loaded: true });
  expect(store.getCachedUserId()).toBe(expectedUser?.id ?? null);
  expect((await client.auth.getSession()).data.session?.user.id ?? null).toBe(expectedUser?.id ?? null);
});
