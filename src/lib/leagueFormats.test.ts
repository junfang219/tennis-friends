import { describe, expect, it } from "vitest";
import {
  LINEUP_PRESETS,
  buildSlots,
  defaultRatingScheme,
  formatLabel,
  levelOptions,
  minCourtsRequired,
  parseLineupFormat,
  rosterMinimumFor,
  validateLineup,
  type LineupAssignment,
  type SeasonLeague,
} from "./leagueFormats";

const p = (name: string, ntrp: number | null) => ({ name, ntrp });

function league(over: Partial<SeasonLeague> = {}): SeasonLeague {
  return {
    division: "adult_40",
    ratingScheme: "straight",
    level: 3.5,
    lineupFormat: buildSlots(1, 3), // PNW 40&O local: 1S+3D
    ...over,
  };
}

describe("buildSlots / formatLabel", () => {
  it("builds ordered S then D codes", () => {
    expect(buildSlots(2, 3).map((s) => s.code)).toEqual(["S1", "S2", "D1", "D2", "D3"]);
  });

  it("labels formats compactly, omitting a zero side", () => {
    expect(formatLabel(buildSlots(2, 3))).toBe("2S+3D");
    expect(formatLabel(buildSlots(0, 3))).toBe("3D");
    expect(formatLabel(buildSlots(1, 0))).toBe("1S");
  });
});

describe("parseLineupFormat", () => {
  it("round-trips a valid jsonb array", () => {
    expect(parseLineupFormat([{ code: "S1", type: "singles" }])).toEqual([
      { code: "S1", type: "singles" },
    ]);
  });

  it("drops malformed entries and returns null for empty/invalid input", () => {
    expect(parseLineupFormat(null)).toBeNull();
    expect(parseLineupFormat("2S+3D")).toBeNull();
    expect(parseLineupFormat([])).toBeNull();
    expect(parseLineupFormat([{ code: "", type: "singles" }, { code: "D1", type: "doubles" }])).toEqual([
      { code: "D1", type: "doubles" },
    ]);
    expect(parseLineupFormat([{ code: "X", type: "triples" }])).toBeNull();
  });

  it("accepts every shipped preset", () => {
    for (const preset of LINEUP_PRESETS) {
      expect(parseLineupFormat(preset.slots)).toEqual(preset.slots);
    }
  });
});

describe("defaultRatingScheme / levelOptions", () => {
  it("uses combined pair-sum levels for Mixed, 55/65&O, and Combo", () => {
    expect(defaultRatingScheme("mixed_18")).toBe("combined");
    expect(defaultRatingScheme("adult_55")).toBe("combined");
    expect(defaultRatingScheme("combo")).toBe("combined");
    expect(defaultRatingScheme("adult_18")).toBe("straight");
    expect(defaultRatingScheme("adult_40")).toBe("straight");
  });

  it("offers straight 2.5–5.5 and combined 5.5–10.0 in half steps", () => {
    const straight = levelOptions("straight");
    expect(straight[0]).toBe(2.5);
    expect(straight[straight.length - 1]).toBe(5.5);
    const combined = levelOptions("combined");
    expect(combined).toContain(7.0);
    expect(combined).toContain(6.5); // combo uses x.5 combined levels
    expect(combined[combined.length - 1]).toBe(10);
  });
});

describe("minCourtsRequired", () => {
  it("matches the published PNW thresholds (majority of courts)", () => {
    expect(minCourtsRequired(5)).toBe(3); // Adult 18&O 5-line
    expect(minCourtsRequired(4)).toBe(3); // Adult 40&O 4-line
    expect(minCourtsRequired(3)).toBe(2); // Mixed / 55&O 3-line
  });
});

describe("validateLineup — straight scheme", () => {
  it("returns no warnings for a full, legal lineup", () => {
    const assignments: LineupAssignment[] = [
      { slotCode: "S1", players: [p("Ana", 3.5)] },
      { slotCode: "D1", players: [p("Bo", 3.0), p("Cy", 3.5)] },
      { slotCode: "D2", players: [p("Di", 3.5), p("Ed", 3.5)] },
      { slotCode: "D3", players: [p("Fi", 2.5), p("Gus", 3.0)] },
    ];
    expect(validateLineup(league(), assignments)).toEqual([]);
  });

  it("warns when a player is rated above the team level", () => {
    const warnings = validateLineup(league(), [
      { slotCode: "S1", players: [p("Ana", 4.0)] },
    ]);
    expect(warnings.some((w) => w.slotCode === "S1" && w.message.includes("4.0"))).toBe(true);
  });

  it("does not warn for unrated players", () => {
    const warnings = validateLineup(league(), [
      { slotCode: "S1", players: [p("Ana", null)] },
    ]);
    expect(warnings.filter((w) => w.slotCode === "S1")).toEqual([]);
  });

  it("warns on over-capacity slots", () => {
    const warnings = validateLineup(league(), [
      { slotCode: "S1", players: [p("Ana", 3.0), p("Bo", 3.0)] },
      { slotCode: "D1", players: [p("Cy", 3.0), p("Di", 3.0), p("Ed", 3.0)] },
    ]);
    expect(warnings.some((w) => w.slotCode === "S1" && w.message.includes("takes 1"))).toBe(true);
    expect(warnings.some((w) => w.slotCode === "D1" && w.message.includes("takes 2"))).toBe(true);
  });

  it("ignores Reserve and custom slots not in the format", () => {
    const warnings = validateLineup(league(), [
      { slotCode: "S1", players: [p("Ana", 3.5)] },
      { slotCode: "D1", players: [p("Bo", 3.0), p("Cy", 3.5)] },
      { slotCode: "D2", players: [p("Di", 3.5), p("Ed", 3.5)] },
      { slotCode: "D3", players: [p("Fi", 2.5), p("Gus", 3.0)] },
      { slotCode: "Reserve", players: [p("Hi", 5.0), p("Iva", 5.0), p("Jo", 5.0)] },
    ]);
    expect(warnings).toEqual([]);
  });

  it("warns when filled courts fall below the default threshold", () => {
    // 1S+3D → needs 3 courts; only S1 and a half-filled D1 here → 1 court.
    const warnings = validateLineup(league(), [
      { slotCode: "S1", players: [p("Ana", 3.5)] },
      { slotCode: "D1", players: [p("Bo", 3.0)] },
    ]);
    const whole = warnings.find((w) => w.slotCode === null);
    expect(whole).toBeDefined();
    expect(whole!.message).toContain("1 of 4");
    expect(whole!.message).toContain("3");
  });

  it("returns no warnings when the season has no lineup format", () => {
    expect(
      validateLineup(league({ lineupFormat: null }), [
        { slotCode: "S1", players: [p("Ana", 7.0)] },
      ])
    ).toEqual([]);
  });
});

describe("validateLineup — combined scheme", () => {
  const mixed = league({
    division: "mixed_18",
    ratingScheme: "combined",
    level: 7.0,
    lineupFormat: buildSlots(0, 3),
  });

  it("accepts pairs at or under the combined level", () => {
    const warnings = validateLineup(mixed, [
      { slotCode: "D1", players: [p("Ana", 3.5), p("Bo", 3.5)] },
      { slotCode: "D2", players: [p("Cy", 3.0), p("Di", 4.0)] },
      { slotCode: "D3", players: [p("Ed", 3.0), p("Fi", 3.5)] },
    ]);
    expect(warnings).toEqual([]);
  });

  it("warns when a pair's sum exceeds the combined level", () => {
    const warnings = validateLineup(mixed, [
      { slotCode: "D1", players: [p("Ana", 4.0), p("Bo", 3.5)] },
    ]);
    expect(warnings.some((w) => w.slotCode === "D1" && w.message.includes("7.5"))).toBe(true);
  });

  it("warns when partners are more than 1.0 apart", () => {
    const warnings = validateLineup(mixed, [
      { slotCode: "D1", players: [p("Ana", 2.5), p("Bo", 4.0)] },
    ]);
    expect(warnings.some((w) => w.slotCode === "D1" && w.message.includes("1.0"))).toBe(true);
  });

  it("skips pair checks until both players are rated", () => {
    const warnings = validateLineup(mixed, [
      { slotCode: "D1", players: [p("Ana", 4.5), p("Bo", null)] },
    ]);
    expect(warnings.filter((w) => w.slotCode === "D1")).toEqual([]);
  });
});

describe("rosterMinimumFor", () => {
  it("returns the national floors per division", () => {
    expect(rosterMinimumFor("adult_18", 3.5)).toBe(8);
    expect(rosterMinimumFor("adult_18", 2.5)).toBe(5);
    expect(rosterMinimumFor("adult_18", 5.0)).toBe(5);
    expect(rosterMinimumFor("adult_40", 4.0)).toBe(9);
    expect(rosterMinimumFor("adult_55", 7.0)).toBe(6);
    expect(rosterMinimumFor("mixed_18", 7.0)).toBe(6);
    expect(rosterMinimumFor("combo", 7.5)).toBeNull();
    expect(rosterMinimumFor(null, null)).toBeNull();
  });
});
