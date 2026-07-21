import { describe, expect, it } from "vitest";
import { leagueDraftFromSearchResult } from "./leagueMeta";

describe("leagueDraftFromSearchResult", () => {
  it("maps Adult 40+ with a straight rating", () => {
    const { draft, seasonName } = leagueDraftFromSearchResult(
      { leagueType: "Adult 40+", ntrp: 3.5 },
      "2026"
    );
    expect(draft.division).toBe("adult_40");
    expect(draft.scheme).toBe("straight");
    expect(draft.level).toBe("3.5");
    expect(draft.formatId).toBe("1s3d");
    expect(seasonName).toBe("2026 Adult 40+");
  });

  it("maps Mixed to combined scheme with a pair-sum level and 3D format", () => {
    const { draft } = leagueDraftFromSearchResult({ leagueType: "Mixed 18+", ntrp: 7.0 });
    expect(draft.division).toBe("mixed_18");
    expect(draft.scheme).toBe("combined");
    expect(draft.level).toBe("7");
    expect(draft.formatId).toBe("3d");
  });

  it("suggests 1S+2D for Adult 18+ at 2.5 and 5.0, 2S+3D in between", () => {
    expect(leagueDraftFromSearchResult({ leagueType: "Adult 18+", ntrp: 2.5 }).draft.formatId).toBe("1s2d");
    expect(leagueDraftFromSearchResult({ leagueType: "Adult 18+", ntrp: 5.0 }).draft.formatId).toBe("1s2d");
    expect(leagueDraftFromSearchResult({ leagueType: "Adult 18+", ntrp: 4.0 }).draft.formatId).toBe("2s3d");
  });

  it("drops a level that does not fit the scheme instead of prefilling an invalid value", () => {
    // A straight-style 3.5 on a Mixed (combined) division is not a combined level.
    const { draft } = leagueDraftFromSearchResult({ leagueType: "Mixed 40+", ntrp: 3.5 });
    expect(draft.division).toBe("mixed_40");
    expect(draft.level).toBe("");
    // No level → 3D suggestion still applies (division-driven).
    expect(draft.formatId).toBe("3d");
  });

  it("maps variant/unknown league types to other/tri_level/combo without a format guess", () => {
    expect(leagueDraftFromSearchResult({ leagueType: "Tri-Level 40+", ntrp: null }).draft.division).toBe("tri_level");
    expect(leagueDraftFromSearchResult({ leagueType: "Combo", ntrp: null }).draft.division).toBe("combo");
    expect(leagueDraftFromSearchResult({ leagueType: "Adult 70+", ntrp: null }).draft.division).toBe("other");
    expect(leagueDraftFromSearchResult({ leagueType: "Flex Format", ntrp: null }).draft.formatId).toBe("");
  });

  it("handles a blank leagueType with a fallback season name", () => {
    const { draft, seasonName } = leagueDraftFromSearchResult({ leagueType: "", ntrp: null });
    expect(draft.division).toBe("");
    expect(seasonName).toBe("USTA season");
  });

  it("keeps 18-39 under adult_18", () => {
    expect(leagueDraftFromSearchResult({ leagueType: "Adult 18-39", ntrp: 3.0 }).draft.division).toBe("adult_18");
  });
});
