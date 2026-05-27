import { describe, expect, it } from "vitest";
import {
  parseScore,
  validateSinglesScore,
  computeStandings,
  seedBracket,
  bracketSlot,
  bracketRounds,
  bracketRoundLabel,
  ladderMaxGap,
} from "./eventCompetitive";

describe("parseScore", () => {
  it("parses standard 'a-b,c-d' tennis scores", () => {
    expect(parseScore("6-4,3-6,7-5")).toEqual([
      [6, 4],
      [3, 6],
      [7, 5],
    ]);
  });

  it("tolerates ':' and '/' separators between games", () => {
    expect(parseScore("6:4;7/5")).toEqual([
      [6, 4],
      [7, 5],
    ]);
  });

  it("drops malformed sets", () => {
    expect(parseScore("6-4,bogus,7-5")).toEqual([
      [6, 4],
      [7, 5],
    ]);
  });

  it("returns [] for empty / whitespace input", () => {
    expect(parseScore("")).toEqual([]);
    expect(parseScore("   ")).toEqual([]);
  });
});

describe("validateSinglesScore", () => {
  it("accepts a standard 2-set win", () => {
    expect(validateSinglesScore([[6, 4], [6, 3]])).toEqual({ ok: true, winnerSide: 1 });
  });

  it("accepts 7-5 / 7-6", () => {
    expect(validateSinglesScore([[7, 5], [7, 6]])).toEqual({ ok: true, winnerSide: 1 });
  });

  it("accepts a match tiebreak", () => {
    expect(validateSinglesScore([[6, 4], [3, 6], [10, 7]])).toEqual({
      ok: true,
      winnerSide: 1,
    });
  });

  it("rejects bogus set scores", () => {
    expect(validateSinglesScore([[6, 9]])).toMatchObject({ ok: false });
    expect(validateSinglesScore([[3, 3]])).toMatchObject({ ok: false });
  });

  it("rejects a match with no winner overall", () => {
    expect(validateSinglesScore([[6, 4], [4, 6]])).toMatchObject({ ok: false });
  });
});

describe("computeStandings", () => {
  it("awards 3 pts per win and 0 per loss", () => {
    const rows = computeStandings(["a", "b", "c"], [
      {
        status: "completed",
        score: "6-4,6-3",
        winnerSide: 1,
        player1Id: "a",
        player2Id: "b",
      },
      {
        status: "completed",
        score: "6-2,6-1",
        winnerSide: 1,
        player1Id: "a",
        player2Id: "c",
      },
    ]);
    const byId = new Map(rows.map((r) => [r.userId, r]));
    expect(byId.get("a")?.points).toBe(6);
    expect(byId.get("a")?.rank).toBe(1);
    expect(byId.get("b")?.losses).toBe(1);
    expect(byId.get("c")?.losses).toBe(1);
  });

  it("ranks ties by set differential then game differential", () => {
    const rows = computeStandings(["a", "b", "c"], [
      {
        status: "completed",
        score: "6-0,6-0",
        winnerSide: 1,
        player1Id: "a",
        player2Id: "c",
      },
      {
        status: "completed",
        score: "6-4,6-4",
        winnerSide: 1,
        player1Id: "b",
        player2Id: "c",
      },
    ]);
    // a and b each have 3 pts, but a's game diff is larger -> rank 1.
    expect(rows[0].userId).toBe("a");
    expect(rows[1].userId).toBe("b");
  });

  it("ignores matches that aren't completed", () => {
    const rows = computeStandings(["a", "b"], [
      {
        status: "in_progress",
        score: "6-0,6-0",
        winnerSide: 1,
        player1Id: "a",
        player2Id: "b",
      },
    ]);
    expect(rows.every((r) => r.points === 0)).toBe(true);
  });
});

describe("seedBracket", () => {
  it("pairs #1 vs lowest, #2 vs second-lowest for power-of-2 fields", () => {
    expect(seedBracket(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"])).toEqual([
      ["p1", "p8"],
      ["p4", "p5"],
      ["p2", "p7"],
      ["p3", "p6"],
    ]);
  });

  it("assigns byes to top seeds when count < bracketSize", () => {
    const pairs = seedBracket(["p1", "p2", "p3", "p4", "p5"]);
    // Bracket size is 8; pairs that include null = bye opponents.
    expect(pairs.length).toBe(4);
    const byes = pairs.filter((p) => p[0] === null || p[1] === null);
    expect(byes.length).toBe(3);
    // #1 seed gets a bye (paired against the 8th slot, which is empty).
    const seedOnePair = pairs.find((p) => p[0] === "p1" || p[1] === "p1");
    expect(seedOnePair?.some((s) => s === null)).toBe(true);
  });
});

describe("bracketRounds / bracketRoundLabel / bracketSlot", () => {
  it("counts rounds", () => {
    expect(bracketRounds(8)).toBe(3);
    expect(bracketRounds(7)).toBe(3);
    expect(bracketRounds(16)).toBe(4);
    expect(bracketRounds(1)).toBe(0);
  });

  it("labels the right rounds from the end", () => {
    expect(bracketRoundLabel(3, 3)).toBe("Final");
    expect(bracketRoundLabel(2, 3)).toBe("Semifinal");
    expect(bracketRoundLabel(1, 3)).toBe("Quarterfinal");
    expect(bracketRoundLabel(1, 4)).toBe("Round of 16");
  });

  it("formats slot ids", () => {
    expect(bracketSlot(1, 0)).toBe("R1-1");
    expect(bracketSlot(2, 3)).toBe("R2-4");
  });
});

describe("ladderMaxGap", () => {
  it("returns 3 by default", () => {
    expect(ladderMaxGap(null)).toBe(3);
    expect(ladderMaxGap({})).toBe(3);
    expect(ladderMaxGap("")).toBe(3);
    expect(ladderMaxGap("not json")).toBe(3);
  });

  it("reads ladderMaxGap from a jsonb object or JSON string", () => {
    expect(ladderMaxGap({ ladderMaxGap: 5 })).toBe(5);
    expect(ladderMaxGap('{"ladderMaxGap":7}')).toBe(7);
  });

  it("falls back to default when the value is invalid", () => {
    expect(ladderMaxGap({ ladderMaxGap: -1 })).toBe(3);
    expect(ladderMaxGap({ ladderMaxGap: "five" })).toBe(3);
  });
});
