import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEMBER_TYPES,
  ROLE,
  isAtLeast,
  parseMemberTypes,
} from "./groupRoles";

describe("isAtLeast", () => {
  it("treats higher roles as satisfying lower minimums", () => {
    expect(isAtLeast(ROLE.OWNER, ROLE.MEMBER)).toBe(true);
    expect(isAtLeast(ROLE.MANAGER, ROLE.CAPTAIN)).toBe(true);
    expect(isAtLeast(ROLE.CAPTAIN, ROLE.MEMBER)).toBe(true);
  });

  it("rejects lower roles against higher minimums", () => {
    expect(isAtLeast(ROLE.MEMBER, ROLE.CAPTAIN)).toBe(false);
    expect(isAtLeast(ROLE.CAPTAIN, ROLE.MANAGER)).toBe(false);
    expect(isAtLeast(ROLE.MANAGER, ROLE.OWNER)).toBe(false);
  });

  it("accepts a role meeting its own minimum", () => {
    expect(isAtLeast(ROLE.OWNER, ROLE.OWNER)).toBe(true);
    expect(isAtLeast(ROLE.MEMBER, ROLE.MEMBER)).toBe(true);
  });

  it("rejects unknown role strings", () => {
    expect(isAtLeast("", ROLE.MEMBER)).toBe(false);
    expect(isAtLeast("GUEST", ROLE.MEMBER)).toBe(false);
  });
});

describe("parseMemberTypes", () => {
  it("returns defaults when raw is empty or invalid JSON", () => {
    expect(parseMemberTypes("")).toEqual([...DEFAULT_MEMBER_TYPES]);
    expect(parseMemberTypes("not json")).toEqual([...DEFAULT_MEMBER_TYPES]);
  });

  it("returns defaults when the parsed value is an empty array", () => {
    expect(parseMemberTypes("[]")).toEqual([...DEFAULT_MEMBER_TYPES]);
  });

  it("returns defaults when the parsed value is not a string array", () => {
    expect(parseMemberTypes('{"a":1}')).toEqual([...DEFAULT_MEMBER_TYPES]);
    expect(parseMemberTypes("[1,2,3]")).toEqual([...DEFAULT_MEMBER_TYPES]);
  });

  it("returns the custom list when valid", () => {
    expect(parseMemberTypes('["A","B"]')).toEqual(["A", "B"]);
  });
});
