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
  mixerPairings,
  shuffleDeterministic,
  roundRobinSinglesSchedule,
  orderForTournamentSeed,
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

describe("shuffleDeterministic", () => {
  it("returns the same order for the same seed", () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    expect(shuffleDeterministic(items, "evt:1")).toEqual(
      shuffleDeterministic(items, "evt:1")
    );
  });

  it("returns a different order for a different seed", () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    const r1 = shuffleDeterministic(items, "evt:1").join(",");
    const r2 = shuffleDeterministic(items, "evt:2").join(",");
    expect(r1).not.toBe(r2);
  });

  it("preserves the multiset", () => {
    const items = ["a", "b", "c", "d", "e"];
    const out = shuffleDeterministic(items, "evt:7");
    expect([...out].sort()).toEqual([...items].sort());
  });
});

describe("mixerPairings", () => {
  it("pairs an even pool with no bye", () => {
    const { pairs, bye } = mixerPairings(["a", "b", "c", "d"], "evt", 1);
    expect(pairs.length).toBe(2);
    expect(bye).toBeNull();
    const flat = pairs.flat();
    expect([...flat].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("assigns a single bye when the pool is odd", () => {
    const { pairs, bye } = mixerPairings(["a", "b", "c", "d", "e"], "evt", 1);
    expect(pairs.length).toBe(2);
    expect(bye).not.toBeNull();
    expect(["a", "b", "c", "d", "e"]).toContain(bye!);
    const flat = [...pairs.flat(), bye!];
    expect([...flat].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("is deterministic across calls (idempotent retry-safe)", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    const first = mixerPairings(ids, "evt-xyz", 3);
    const second = mixerPairings(ids, "evt-xyz", 3);
    expect(second).toEqual(first);
  });

  it("returns no pairs / null bye for an empty pool", () => {
    expect(mixerPairings([], "evt", 1)).toEqual({ pairs: [], bye: null });
  });
});

describe("roundRobinSinglesSchedule", () => {
  it("produces N-1 rounds with N/2 pairs each for even N", () => {
    const { rounds } = roundRobinSinglesSchedule(["a", "b", "c", "d"]);
    expect(rounds.length).toBe(3);
    for (const r of rounds) {
      expect(r.pairs.length).toBe(2);
      expect(r.bye).toBeNull();
    }
  });

  it("rotates the bye through every player for odd N", () => {
    const { rounds } = roundRobinSinglesSchedule(["a", "b", "c"]);
    expect(rounds.length).toBe(3);
    const byes = new Set(rounds.map((r) => r.bye));
    expect(byes).toEqual(new Set(["a", "b", "c"]));
  });

  it("pairs every player with every other player exactly once", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const { rounds } = roundRobinSinglesSchedule(ids);
    const seen = new Set<string>();
    for (const r of rounds) {
      for (const [x, y] of r.pairs) {
        const key = [x, y].sort().join("|");
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
    // C(6,2) = 15 unique pairs.
    expect(seen.size).toBe(15);
  });

  it("returns no rounds for fewer than 2 players", () => {
    expect(roundRobinSinglesSchedule([]).rounds).toEqual([]);
    expect(roundRobinSinglesSchedule(["solo"]).rounds).toEqual([]);
  });
});

describe("orderForTournamentSeed", () => {
  const mk = (id: string, ntrp: number | null, ts: string) => ({
    user_id: id,
    registered_at: ts,
    user: { ntrp_rating: ntrp },
  });

  it("ranks by NTRP descending, signup time ascending as tiebreaker", () => {
    const out = orderForTournamentSeed([
      mk("b", 4.0, "2026-01-02T00:00:00Z"),
      mk("a", 4.5, "2026-01-03T00:00:00Z"),
      mk("c", 4.0, "2026-01-01T00:00:00Z"),
    ]);
    expect(out.map((p) => p.user_id)).toEqual(["a", "c", "b"]);
  });

  it("slots unrated players below rated ones", () => {
    const out = orderForTournamentSeed([
      mk("unrated", null, "2026-01-01T00:00:00Z"),
      mk("rated", 3.5, "2026-01-02T00:00:00Z"),
    ]);
    expect(out.map((p) => p.user_id)).toEqual(["rated", "unrated"]);
  });

  it("is stable for fully tied input (uuid tiebreaker)", () => {
    const out = orderForTournamentSeed([
      mk("b", 4.0, "2026-01-01T00:00:00Z"),
      mk("a", 4.0, "2026-01-01T00:00:00Z"),
    ]);
    expect(out.map((p) => p.user_id)).toEqual(["a", "b"]);
  });
});
