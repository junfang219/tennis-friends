import { describe, expect, it } from "vitest";
import { hasSeenFlag, markFlagSeen } from "./seenFlags";

function fakeStorage(): Pick<Storage, "getItem" | "setItem"> & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe("seenFlags", () => {
  it("roundtrips unseen → seen", () => {
    const storage = fakeStorage();
    expect(hasSeenFlag("tf:seen:x", storage)).toBe(false);
    markFlagSeen("tf:seen:x", storage);
    expect(hasSeenFlag("tf:seen:x", storage)).toBe(true);
    expect(storage.map.get("tf:seen:x")).toMatch(/^\d+$/);
  });

  it("keeps flags independent per key", () => {
    const storage = fakeStorage();
    markFlagSeen("tf:seen:a", storage);
    expect(hasSeenFlag("tf:seen:a", storage)).toBe(true);
    expect(hasSeenFlag("tf:seen:b", storage)).toBe(false);
  });

  it("treats missing storage (SSR / privacy mode) as seen and write as no-op", () => {
    expect(hasSeenFlag("tf:seen:x", null)).toBe(true);
    expect(() => markFlagSeen("tf:seen:x", null)).not.toThrow();
  });

  it("treats a throwing storage as seen", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(hasSeenFlag("tf:seen:x", throwing)).toBe(true);
    expect(() => markFlagSeen("tf:seen:x", throwing)).not.toThrow();
  });
});
