import { describe, it, expect } from "vitest";
import {
  normalizeName,
  levenshtein,
  rankMembersFor,
  planRosterReconciliation,
  type RosterMember,
} from "./rosterMatch";

const members: RosterMember[] = [
  { memberId: "m1", name: "Krista Davis" },
  { memberId: "m2", name: "Jun Fang" },
  { memberId: "m3", name: "Allison Macbeth" },
];

describe("normalizeName", () => {
  it("trims, lowercases, and collapses whitespace", () => {
    expect(normalizeName("  Jun   Fang ")).toBe("jun fang");
    expect(normalizeName("KRISTA DAVIS")).toBe("krista davis");
  });
});

describe("levenshtein", () => {
  it("is 0 for identical strings", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
  });
  it("counts single edits", () => {
    expect(levenshtein("alison", "allison")).toBe(1); // one insertion
    expect(levenshtein("", "abc")).toBe(3);
  });
});

describe("planRosterReconciliation", () => {
  it("maps an exact (case/space-insensitive) match to that member", () => {
    const [d] = planRosterReconciliation(["  jun   fang "], members);
    expect(d).toEqual({ action: "map", memberId: "m2" });
  });

  it("defaults an unmatched name to add", () => {
    const [d] = planRosterReconciliation(["Sarah Salemy"], members);
    expect(d).toEqual({ action: "add" });
  });

  it("does NOT auto-map a different spelling (left for the captain)", () => {
    // "Alison MacBeth" (one L) vs member "Allison Macbeth" (two Ls) — not exact.
    const [d] = planRosterReconciliation(["Alison MacBeth"], members);
    expect(d).toEqual({ action: "add" });
  });

  it("preserves order and length", () => {
    const ds = planRosterReconciliation(
      ["Jun Fang", "Sarah Salemy", "Krista Davis"],
      members,
    );
    expect(ds).toEqual([
      { action: "map", memberId: "m2" },
      { action: "add" },
      { action: "map", memberId: "m1" },
    ]);
  });
});

describe("rankMembersFor", () => {
  it("puts the closest-spelled member first", () => {
    const ranked = rankMembersFor("Alison MacBeth", members);
    expect(ranked[0].memberId).toBe("m3"); // Allison Macbeth
  });

  it("keeps original order for equally-distant (tied) members", () => {
    const tied: RosterMember[] = [
      { memberId: "a", name: "Same Name" },
      { memberId: "b", name: "Same Name" },
    ];
    const ranked = rankMembersFor("Totally Different", tied);
    expect(ranked.map((m) => m.memberId)).toEqual(["a", "b"]);
  });
});
