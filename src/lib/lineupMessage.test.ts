import { describe, expect, it } from "vitest";
import { buildLineupText, compareSlots, type LineupMatch } from "./lineupMessage";

function slot(lineupSlot: string, name: string): LineupMatch["availabilities"][number] {
  return { lineupSlot, user: { name } };
}

function match(over: Partial<LineupMatch> = {}): LineupMatch {
  return {
    matchDate: "2026-06-12",
    matchTime: "10:00 AM",
    location: "Lower Woodland",
    opponent: "Greenlake Smashers",
    availabilities: [],
    ...over,
  };
}

describe("buildLineupText", () => {
  it("sorts slots S-before-D in numeric order", () => {
    const out = buildLineupText(
      match({
        availabilities: [slot("D1", "Sarah"), slot("S2", "Jane"), slot("S1", "John")],
      }),
    );
    expect(out).toContain("S1: John\nS2: Jane\nD1: Sarah");
  });

  it("joins two players on the same slot with ' & '", () => {
    const out = buildLineupText(
      match({ availabilities: [slot("D1", "Mike"), slot("D1", "Alex")] }),
    );
    expect(out).toContain("D1: Mike & Alex");
  });

  it("includes time and opponent in the header when present", () => {
    const out = buildLineupText(match({ availabilities: [slot("S1", "John")] }));
    expect(out).toBe(
      "🎾 Lineup for Fri, Jun 12 at 10:00 AM\n📍 Lower Woodland\n🆚 Greenlake Smashers\n\nS1: John",
    );
  });

  it("omits time and opponent when blank", () => {
    const out = buildLineupText(
      match({ matchTime: "", opponent: "", availabilities: [slot("S1", "John")] }),
    );
    expect(out).toBe("🎾 Lineup for Fri, Jun 12\n📍 Lower Woodland\n\nS1: John");
  });

  it("returns null when no player is assigned to a slot", () => {
    expect(buildLineupText(match({ availabilities: [slot("", "John"), slot("  ", "Jane")] }))).toBeNull();
    expect(buildLineupText(match({ availabilities: [] }))).toBeNull();
  });
});

describe("compareSlots", () => {
  it("orders known slots by canonical rank and falls back to locale compare", () => {
    expect(["D1", "S1", "Reserve", "S3"].sort(compareSlots)).toEqual(["S1", "S3", "D1", "Reserve"]);
    expect(["Zebra", "Apple"].sort(compareSlots)).toEqual(["Apple", "Zebra"]);
  });
});
