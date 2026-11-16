import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), onChange: vi.fn(), from: vi.fn(), insert: vi.fn() }));
vi.mock("./browser", () => ({ createSupabaseBrowserClient: () => ({
  auth: { getUser: mocks.getUser, onAuthStateChange: mocks.onChange }, from: mocks.from,
}) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => "web" } }));
vi.mock("react", () => ({
  useSyncExternalStore: <T>(subscribe: (cb: () => void) => () => void, getSnapshot: () => T) => {
    subscribe(() => {});
    return getSnapshot();
  },
}));

const session: Session = {
  access_token: "test-only", refresh_token: "test-only", expires_in: 3600, token_type: "bearer",
  user: { id: "test-user", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
};
type Listener = (event: AuthChangeEvent, session: Session | null) => void;
let listener: Listener;
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers();
  vi.stubGlobal("window", { location: { pathname: "/groups" } });
  vi.stubGlobal("document", { visibilityState: "visible" });
  mocks.getUser.mockReturnValue(new Promise(() => {}));
  mocks.onChange.mockImplementation((callback: Listener) => { listener = callback; });
  mocks.from.mockReturnValue({ insert: mocks.insert });
  mocks.insert.mockResolvedValue({ error: null });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("publishes auth state immediately but waits until after the auth callback for database I/O", async () => {
  const store = await import("./auth-store");
  store.useAuthSnapshot();
  listener("SIGNED_IN", session);
  expect(store.getCachedUserId()).toBe("test-user");
  expect(mocks.from).not.toHaveBeenCalled();
  await vi.runOnlyPendingTimersAsync();
  expect(mocks.from).toHaveBeenCalledWith("auth_debug_events");
  expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ event: "SIGNED_IN", has_session: true }));
});

it("captures sign-out intent and page context before deferred diagnostics run", async () => {
  const store = await import("./auth-store");
  store.useAuthSnapshot();
  listener("SIGNED_IN", session);
  store.markUserInitiatedSignOut();
  listener("SIGNED_OUT", null);
  window.location.pathname = "/login";
  await vi.runOnlyPendingTimersAsync();
  expect(mocks.insert).toHaveBeenLastCalledWith(expect.objectContaining({
    event: "SIGNED_OUT", user_initiated: true, prior_user_id: "test-user",
    details: { path: "/groups", visibility: "visible" },
  }));
});

it("settles initial loading when the initial auth request rejects", async () => {
  mocks.getUser.mockRejectedValue(new Error("Auth temporarily unavailable"));
  const store = await import("./auth-store");
  store.useAuthSnapshot();
  await Promise.resolve(); await Promise.resolve();
  expect(store.useAuthSnapshot()).toMatchObject({ loaded: true, user: null });
});

it("preserves an event-provided identity if an older initial auth request rejects", async () => {
  let rejectInitial: (reason: Error) => void = () => {};
  mocks.getUser.mockReturnValue(new Promise((_resolve, reject) => { rejectInitial = reject; }));
  const store = await import("./auth-store");
  store.useAuthSnapshot();
  listener("SIGNED_IN", session);
  rejectInitial(new Error("Initial request failed"));
  await Promise.resolve(); await Promise.resolve();
  expect(store.useAuthSnapshot()).toMatchObject({ loaded: true, user: { id: "test-user" } });
});
