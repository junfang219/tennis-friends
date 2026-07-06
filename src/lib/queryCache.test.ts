import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetForTests,
  clearAllCached,
  getCached,
  setCached,
  subscribeCached,
} from "./queryCache";

afterEach(() => {
  __resetForTests();
});

describe("queryCache", () => {
  it("returns undefined for keys never written", () => {
    expect(getCached("missing")).toBeUndefined();
  });

  it("round-trips values", () => {
    setCached("a", { value: 1 });
    expect(getCached<{ value: number }>("a")).toEqual({ value: 1 });
  });

  it("notifies subscribers on set", () => {
    const listener = vi.fn();
    subscribeCached("k", listener);
    setCached("k", "v1");
    setCached("k", "v2");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("does not notify subscribers of other keys", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeCached("a", a);
    subscribeCached("b", b);
    setCached("a", 1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it("unsubscribe stops further notifications", () => {
    const listener = vi.fn();
    const off = subscribeCached("k", listener);
    setCached("k", 1);
    off();
    setCached("k", 2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("clearAllCached wipes values and notifies live subscribers", () => {
    setCached("a", 1);
    setCached("b", 2);
    const aListener = vi.fn();
    const bListener = vi.fn();
    subscribeCached("a", aListener);
    subscribeCached("b", bListener);
    clearAllCached();
    expect(getCached("a")).toBeUndefined();
    expect(getCached("b")).toBeUndefined();
    expect(aListener).toHaveBeenCalledTimes(1);
    expect(bListener).toHaveBeenCalledTimes(1);
  });

  it("clearAllCached doesn't notify keys with no live subscribers", () => {
    // Tests that we don't leak listener-Set entries when there's nothing to fire.
    setCached("zombie", 1);
    expect(() => clearAllCached()).not.toThrow();
    expect(getCached("zombie")).toBeUndefined();
  });

  it("allows multiple subscribers per key", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeCached("k", a);
    subscribeCached("k", b);
    setCached("k", 1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe("queryCache persistence", () => {
  // Minimal localStorage stub (node test env has no window).
  function installStorage() {
    const store = new Map<string, string>();
    const localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      get length() {
        return store.size;
      },
      key: (i: number) => [...store.keys()][i] ?? null,
    };
    (globalThis as { window?: unknown }).window = { localStorage };
    return store;
  }

  afterEach(() => {
    __resetForTests();
    delete (globalThis as { window?: unknown }).window;
  });

  it("does not persist when persist=false", () => {
    const store = installStorage();
    setCached("calendar:all", { events: [1] });
    expect(store.size).toBe(0);
  });

  it("mirrors persisted values to localStorage under the qc: prefix", () => {
    const store = installStorage();
    setCached("calendar:all", { events: [1] }, true);
    expect(store.get("qc:calendar:all")).toBe(JSON.stringify({ events: [1] }));
  });

  it("hydrates the in-memory cache from localStorage on a cold read (relaunch)", () => {
    const store = installStorage();
    store.set("qc:calendar:all", JSON.stringify({ events: [42] }));
    // Simulates a fresh app launch: Map is empty, localStorage survives.
    expect(getCached("calendar:all", true)).toEqual({ events: [42] });
  });

  it("returns a stable reference across reads so getSnapshot is safe", () => {
    installStorage();
    setCached("calendar:all", { events: [1] }, true);
    const first = getCached("calendar:all", true);
    const second = getCached("calendar:all", true);
    expect(first).toBe(second);
  });

  it("clearAllCached removes persisted qc: entries", () => {
    const store = installStorage();
    setCached("calendar:all", { events: [1] }, true);
    store.set("unrelated", "keep-me");
    clearAllCached();
    expect(store.get("qc:calendar:all")).toBeUndefined();
    expect(store.get("unrelated")).toBe("keep-me");
  });
});
