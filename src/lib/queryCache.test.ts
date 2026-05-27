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
