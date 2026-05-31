import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEMBER_TYPES,
  canAdmin,
  canCaptain,
  parseMemberTypes,
  parseRoles,
} from "./groupRoles";

describe("parseRoles", () => {
  it("returns a real array (jsonb shape from the Supabase client)", () => {
    expect(parseRoles(["manager", "captain"])).toEqual(["manager", "captain"]);
    expect(parseRoles(["captain"])).toEqual(["captain"]);
  });

  it("returns [] for empty / null / undefined", () => {
    expect(parseRoles([])).toEqual([]);
    expect(parseRoles(null)).toEqual([]);
    expect(parseRoles(undefined)).toEqual([]);
  });

  it("parses a JSON-encoded string", () => {
    expect(parseRoles('["manager"]')).toEqual(["manager"]);
    expect(parseRoles("not json")).toEqual([]);
  });

  it("drops unrecognized roles (e.g. a stale 'owner'/'member')", () => {
    expect(parseRoles(["owner", "manager", "member", "captain"])).toEqual([
      "manager",
      "captain",
    ]);
    expect(parseRoles([1, 2, 3] as unknown[])).toEqual([]);
  });
});

describe("canAdmin (manager capability)", () => {
  it("is true for the owner regardless of roles", () => {
    expect(canAdmin({ isOwner: true, roles: [] })).toBe(true);
    expect(canAdmin({ isOwner: true, roles: ["captain"] })).toBe(true);
  });

  it("is true for a manager", () => {
    expect(canAdmin({ isOwner: false, roles: ["manager"] })).toBe(true);
    expect(canAdmin({ isOwner: false, roles: ["manager", "captain"] })).toBe(true);
  });

  it("is false for a captain-only or plain member", () => {
    expect(canAdmin({ isOwner: false, roles: ["captain"] })).toBe(false);
    expect(canAdmin({ isOwner: false, roles: [] })).toBe(false);
  });
});

describe("canCaptain (ops capability)", () => {
  it("is true for the owner regardless of roles", () => {
    expect(canCaptain({ isOwner: true, roles: [] })).toBe(true);
  });

  it("is true for a captain", () => {
    expect(canCaptain({ isOwner: false, roles: ["captain"] })).toBe(true);
    expect(canCaptain({ isOwner: false, roles: ["manager", "captain"] })).toBe(true);
  });

  it("is INDEPENDENT of manager — a manager-only member is not a captain", () => {
    expect(canCaptain({ isOwner: false, roles: ["manager"] })).toBe(false);
  });

  it("is false for a plain member", () => {
    expect(canCaptain({ isOwner: false, roles: [] })).toBe(false);
  });
});

describe("parseMemberTypes", () => {
  it("returns defaults when raw is empty or invalid JSON", () => {
    expect(parseMemberTypes("")).toEqual([...DEFAULT_MEMBER_TYPES]);
    expect(parseMemberTypes("not json")).toEqual([...DEFAULT_MEMBER_TYPES]);
  });

  it("returns defaults when the parsed value is an empty array", () => {
    expect(parseMemberTypes("[]")).toEqual([...DEFAULT_MEMBER_TYPES]);
    expect(parseMemberTypes([])).toEqual([...DEFAULT_MEMBER_TYPES]);
  });

  it("returns the custom list when valid (string or real array)", () => {
    expect(parseMemberTypes('["A","B"]')).toEqual(["A", "B"]);
    expect(parseMemberTypes(["A", "B"])).toEqual(["A", "B"]);
  });
});
