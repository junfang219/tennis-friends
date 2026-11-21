import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ initialize: vi.fn(), getSession: vi.fn(), getUser: vi.fn(), onChange: vi.fn(), from: vi.fn(), insert: vi.fn() }));
vi.mock("./browser", () => ({ createSupabaseBrowserClient: () => ({
  auth: { initialize: mocks.initialize, getSession: mocks.getSession, getUser: mocks.getUser, onAuthStateChange: mocks.onChange }, from: mocks.from,
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
const otherSession: Session = { ...session, access_token: "other-test-only", user: { ...session.user, id: "other-user" } };
type UserResult = { data: { user: User | null } };
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
async function flushPromises() { await vi.advanceTimersByTimeAsync(0); }
async function pendingUserRequest(source: "initial" | "refresh") {
  const pending = deferred<UserResult>();
  const store = await import("./auth-store");
  if (source === "initial") mocks.getUser.mockReturnValueOnce(pending.promise);
  else mocks.getUser.mockResolvedValueOnce({ data: { user: session.user } });
  store.useAuthSnapshot();
  await flushPromises();
  listener("INITIAL_SESSION", session);
  let request: Promise<void> | undefined;
  if (source === "refresh") {
    mocks.getUser.mockReturnValueOnce(pending.promise);
    request = store.refreshAuthSnapshot();
    await flushPromises();
  }
  return { store, pending, request };
}
type Listener = (event: AuthChangeEvent, session: Session | null) => void;
let listener: Listener;
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); vi.useFakeTimers();
  vi.stubGlobal("window", { location: { pathname: "/groups" } });
  vi.stubGlobal("document", { visibilityState: "visible" });
  mocks.initialize.mockResolvedValue({ error: null });
  mocks.getSession.mockResolvedValue({ data: { session }, error: null });
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
  await flushPromises();
  expect(store.useAuthSnapshot()).toMatchObject({ loaded: true, user: null });
});

it("preserves an event-provided identity if an older initial auth request rejects", async () => {
  let rejectInitial: (reason: Error) => void = () => {};
  mocks.getUser.mockReturnValue(new Promise((_resolve, reject) => { rejectInitial = reject; }));
  const store = await import("./auth-store");
  store.useAuthSnapshot();
  await flushPromises();
  listener("SIGNED_IN", session);
  rejectInitial(new Error("Initial request failed"));
  await flushPromises();
  expect(store.useAuthSnapshot()).toMatchObject({ loaded: true, user: { id: "test-user" } });
});

it.each(["initial", "refresh"] as const)("ignores an old %s user result after sign-out", async source => {
  const { store, pending, request } = await pendingUserRequest(source);
  listener("SIGNED_OUT", null);
  pending.resolve({ data: { user: session.user } });
  await request; await flushPromises();
  expect(store.useAuthSnapshot()).toEqual({ user: null, loaded: true });
  expect(store.getCachedUserId()).toBeNull();
});

it.each(["initial", "refresh"] as const)("ignores an old %s account after switching accounts", async source => {
  const { store, pending, request } = await pendingUserRequest(source);
  listener("SIGNED_OUT", null);
  listener("SIGNED_IN", otherSession);
  pending.resolve({ data: { user: session.user } });
  await request; await flushPromises();
  expect(store.useAuthSnapshot()).toEqual({ user: otherSession.user, loaded: true });
  expect(store.getCachedUserId()).toBe("other-user");
});

it.each(["initial", "refresh"] as const)("ignores a stale signed-out %s result after a new sign-in", async source => {
  const { store, pending, request } = await pendingUserRequest(source);
  listener("SIGNED_IN", otherSession);
  pending.resolve({ data: { user: null } });
  await request; await flushPromises();
  expect(store.getCachedUserId()).toBe("other-user");
});

it.each(["SIGNED_OUT", "SIGNED_IN"] as const)("ignores a delayed INITIAL_SESSION after %s", async event => {
  const { store } = await pendingUserRequest("initial");
  listener(event, event === "SIGNED_OUT" ? null : otherSession);
  listener("INITIAL_SESSION", session);
  expect(store.getCachedUserId()).toBe(event === "SIGNED_OUT" ? null : "other-user");
});

it("keeps a newer same-account auth update over an older lookup", async () => {
  const { store, pending, request } = await pendingUserRequest("refresh");
  const updated = { ...session, user: { ...session.user, user_metadata: { name: "Updated name" } } };
  listener("USER_UPDATED", updated);
  pending.resolve({ data: { user: session.user } });
  await request;
  expect(store.useAuthSnapshot().user).toEqual(updated.user);
});

it("lets the latest refresh win when requests finish out of order", async () => {
  const { store, pending: initial } = await pendingUserRequest("initial");
  const older = deferred<UserResult>();
  const newer = deferred<UserResult>();
  mocks.getUser.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  const olderRequest = store.refreshAuthSnapshot();
  await flushPromises();
  const newerRequest = store.refreshAuthSnapshot();
  await flushPromises();
  newer.resolve({ data: { user: otherSession.user } });
  await newerRequest;
  older.resolve({ data: { user: session.user } });
  await olderRequest;
  initial.resolve({ data: { user: null } });
  await flushPromises();
  expect(store.getCachedUserId()).toBe("other-user");
});

it("propagates refresh errors while preserving the current identity", async () => {
  const { store, pending, request } = await pendingUserRequest("refresh");
  const error = new Error("Refresh failed");
  const rejected = expect(request).rejects.toBe(error);
  listener("SIGNED_IN", otherSession);
  pending.reject(error);
  await rejected;
  expect(store.getCachedUserId()).toBe("other-user");
});

it("settles loading if a newer refresh fails while the initial lookup is pending", async () => {
  const initial = deferred<UserResult>();
  mocks.getUser.mockReturnValueOnce(initial.promise);
  const store = await import("./auth-store");
  store.useAuthSnapshot();
  await flushPromises();
  mocks.getUser.mockRejectedValueOnce(new Error("Refresh failed"));
  await expect(store.refreshAuthSnapshot()).rejects.toThrow("Refresh failed");
  expect(store.useAuthSnapshot()).toEqual({ user: null, loaded: true });
  initial.resolve({ data: { user: session.user } });
  await flushPromises();
  expect(store.getCachedUserId()).toBeNull();
});

it.each([session.user, null])("lets the initial lookup validate the bootstrap session: %j", async user => {
  const { store, pending } = await pendingUserRequest("initial");
  pending.resolve({ data: { user } });
  await flushPromises();
  expect(store.useAuthSnapshot()).toEqual({ user, loaded: true });
});

it("ignores a delayed bootstrap session after a user lookup has completed", async () => {
  mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
  const store = await import("./auth-store");
  store.useAuthSnapshot();
  await flushPromises();
  listener("INITIAL_SESSION", session);
  expect(store.getCachedUserId()).toBeNull();
});

it("can still initialize from the session after a rejected bootstrap lookup", async () => {
  mocks.getUser.mockRejectedValueOnce(new Error("Offline"));
  const store = await import("./auth-store");
  store.useAuthSnapshot();
  await flushPromises();
  listener("INITIAL_SESSION", session);
  expect(store.useAuthSnapshot()).toEqual({ user: session.user, loaded: true });
});

it.each(["sign-out", "account switch", "token refresh"] as const)("discards an old session prepared during %s", async action => {
  mocks.getUser.mockResolvedValueOnce({ data: { user: session.user } });
  const store = await import("./auth-store");
  store.useAuthSnapshot();
  await flushPromises();
  const pending = deferred<{ data: { session: Session | null }; error: null }>();
  mocks.getSession.mockReturnValueOnce(pending.promise);
  const request = store.refreshAuthSnapshot();
  await flushPromises();
  const refreshed = { ...session, access_token: "refreshed-test-only", user: { ...session.user, user_metadata: { name: "Updated name" } } };
  if (action === "token refresh") listener("TOKEN_REFRESHED", refreshed);
  else {
    listener("SIGNED_OUT", null);
    if (action === "account switch") listener("SIGNED_IN", otherSession);
  }
  pending.resolve({ data: { session }, error: null });
  await request;
  expect(mocks.getUser).toHaveBeenCalledTimes(1);
  const expectedUser = action === "sign-out" ? null : action === "account switch" ? otherSession.user : refreshed.user;
  expect(store.useAuthSnapshot()).toEqual({ user: expectedUser, loaded: true });
});

it("preserves a token refresh received after server validation starts", async () => {
  const { store, pending, request } = await pendingUserRequest("refresh");
  const refreshed = { ...session, access_token: "refreshed-test-only" };
  listener("TOKEN_REFRESHED", refreshed);
  pending.resolve({ data: { user: null } });
  await request;
  expect(store.useAuthSnapshot()).toEqual({ user: session.user, loaded: true });
});

it("settles a missing session without starting implicit-token validation", async () => {
  mocks.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
  const store = await import("./auth-store");
  store.useAuthSnapshot();
  await flushPromises();
  expect(store.useAuthSnapshot()).toEqual({ user: null, loaded: true });
  expect(mocks.getUser).not.toHaveBeenCalled();
});

it("validates the explicit token returned by session preparation", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: session.user } });
  const store = await import("./auth-store");
  store.useAuthSnapshot();
  await flushPromises();
  const refreshed = { ...session, access_token: "refreshed-test-only" };
  mocks.getSession.mockImplementationOnce(async () => {
    listener("TOKEN_REFRESHED", refreshed);
    return { data: { session: refreshed }, error: null };
  });
  const validatedUser = { ...session.user, user_metadata: { name: "Validated name" } };
  mocks.getUser.mockResolvedValueOnce({ data: { user: validatedUser } });
  await store.refreshAuthSnapshot();
  expect(mocks.getUser).toHaveBeenLastCalledWith(refreshed.access_token);
  expect(store.useAuthSnapshot()).toEqual({ user: validatedUser, loaded: true });
});
