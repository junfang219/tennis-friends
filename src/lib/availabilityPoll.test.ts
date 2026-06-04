import { describe, expect, it } from "vitest";
import { rankWindows, validateBlock, type MemberResponse } from "./availabilityPoll";

const DATE = "2026-06-08";

function member(id: string, name: string, blocks: Array<{ date?: string; start: string; end: string }>): MemberResponse {
  return {
    userId: id,
    userName: name,
    blocks: blocks.map((b) => ({ date: b.date ?? DATE, start: b.start, end: b.end })),
  };
}

describe("rankWindows", () => {
  it("returns a single window when 3 members all share 9-11", () => {
    const result = rankWindows(
      { candidateDates: [DATE], minBlockMinutes: 120, minPlayers: 2 },
      [
        member("a", "Alice", [{ start: "09:00", end: "11:00" }]),
        member("b", "Bob", [{ start: "09:00", end: "11:00" }]),
        member("c", "Carol", [{ start: "09:00", end: "11:00" }]),
      ],
    );
    expect(result.top).toHaveLength(1);
    expect(result.top[0]).toMatchObject({
      date: DATE,
      start: "09:00",
      end: "11:00",
      durationMinutes: 120,
    });
    expect(result.top[0].memberNames).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("emits no top window when the only multi-member overlap is below the 2h floor", () => {
    // A: 9-11, B: 10-12 — the 2-player overlap is only 10-11 (1h, below 2h
    // floor). A and B each have their own 2h solo window, which surface as
    // 1-player near-misses. Carol's 10-11 block is itself below the floor
    // and gets dropped before ranking.
    const result = rankWindows(
      { candidateDates: [DATE], minBlockMinutes: 120, minPlayers: 2 },
      [
        member("a", "Alice", [{ start: "09:00", end: "11:00" }]),
        member("b", "Bob",   [{ start: "10:00", end: "12:00" }]),
        member("c", "Carol", [{ start: "10:00", end: "11:00" }]),
      ],
    );
    expect(result.top).toEqual([]);
    expect(result.nearMiss).toHaveLength(2);
    const names = result.nearMiss.map((w) => w.memberNames[0]).sort();
    expect(names).toEqual(["Alice", "Bob"]);
  });

  it("ignores members with no response on that date", () => {
    const result = rankWindows(
      { candidateDates: [DATE], minBlockMinutes: 120, minPlayers: 2 },
      [
        member("a", "Alice", [{ start: "09:00", end: "11:00" }]),
        member("b", "Bob",   [{ start: "09:00", end: "11:00" }]),
        member("c", "Carol", []),
      ],
    );
    expect(result.top[0].memberNames).toEqual(["Alice", "Bob"]);
  });

  it("dedupes overlapping blocks from a single member", () => {
    const result = rankWindows(
      { candidateDates: [DATE], minBlockMinutes: 120, minPlayers: 1 },
      [
        member("a", "Alice", [
          { start: "09:00", end: "11:00" },
          { start: "10:00", end: "12:00" },
        ]),
      ],
    );
    // Single member, but spans 9-12 — peak coverage 1 throughout, longest at-peak run = 3h.
    expect(result.top).toHaveLength(1);
    expect(result.top[0]).toMatchObject({ start: "09:00", end: "12:00", durationMinutes: 180 });
    expect(result.top[0].memberIds).toEqual(["a"]);
  });

  it("tie-breaks same-count windows by duration (longer first)", () => {
    const D1 = "2026-06-08";
    const D2 = "2026-06-09";
    const result = rankWindows(
      { candidateDates: [D1, D2], minBlockMinutes: 120, minPlayers: 2 },
      [
        member("a", "Alice", [
          { date: D1, start: "09:00", end: "11:00" }, // 2h with Bob
          { date: D2, start: "09:00", end: "12:00" }, // 3h with Bob
        ]),
        member("b", "Bob", [
          { date: D1, start: "09:00", end: "11:00" },
          { date: D2, start: "09:00", end: "12:00" },
        ]),
      ],
    );
    expect(result.top).toHaveLength(2);
    expect(result.top[0]).toMatchObject({ date: D2, durationMinutes: 180 });
    expect(result.top[1]).toMatchObject({ date: D1, durationMinutes: 120 });
  });

  it("tie-breaks same count and duration by earliest date+start", () => {
    const D1 = "2026-06-08";
    const D2 = "2026-06-09";
    const result = rankWindows(
      { candidateDates: [D1, D2], minBlockMinutes: 120, minPlayers: 2 },
      [
        member("a", "Alice", [
          { date: D1, start: "14:00", end: "16:00" },
          { date: D2, start: "09:00", end: "11:00" },
        ]),
        member("b", "Bob", [
          { date: D1, start: "14:00", end: "16:00" },
          { date: D2, start: "09:00", end: "11:00" },
        ]),
      ],
    );
    expect(result.top).toHaveLength(2);
    // Same duration (120), same member count (2). Earlier date wins.
    expect(result.top[0].date).toBe(D1);
    expect(result.top[1].date).toBe(D2);
  });

  it("emits no window when no overlap meets the duration floor", () => {
    const result = rankWindows(
      { candidateDates: [DATE], minBlockMinutes: 120, minPlayers: 2 },
      [
        member("a", "Alice", [{ start: "09:00", end: "11:00" }]),
        member("b", "Bob",   [{ start: "14:00", end: "16:00" }]),
      ],
    );
    // Two disjoint 1-member windows; both below the minPlayers=2 threshold AND
    // they're 1 player short, so they land in nearMiss.
    expect(result.top).toEqual([]);
    expect(result.nearMiss).toHaveLength(2);
    expect(result.nearMiss[0].memberIds).toHaveLength(1);
  });

  it("demotes sub-threshold windows to nearMiss", () => {
    const result = rankWindows(
      { candidateDates: [DATE], minBlockMinutes: 120, minPlayers: 3 },
      [
        member("a", "Alice", [{ start: "09:00", end: "11:00" }]),
        member("b", "Bob",   [{ start: "09:00", end: "11:00" }]),
      ],
    );
    expect(result.top).toEqual([]);
    expect(result.nearMiss).toHaveLength(1);
    expect(result.nearMiss[0].memberIds).toHaveLength(2);
  });

  it("respects a 3h minBlockMinutes floor", () => {
    const result = rankWindows(
      { candidateDates: [DATE], minBlockMinutes: 180, minPlayers: 2 },
      [
        member("a", "Alice", [{ start: "09:00", end: "11:00" }]), // 2h — dropped
        member("b", "Bob",   [{ start: "09:00", end: "12:00" }]), // 3h — kept
      ],
    );
    expect(result.top).toEqual([]);
    expect(result.nearMiss).toHaveLength(1);
    expect(result.nearMiss[0].memberIds).toEqual(["b"]);
  });

  it("handles a 30-minute non-aligned start time correctly", () => {
    const result = rankWindows(
      { candidateDates: [DATE], minBlockMinutes: 120, minPlayers: 2 },
      [
        member("a", "Alice", [{ start: "09:30", end: "11:30" }]),
        member("b", "Bob",   [{ start: "09:30", end: "11:30" }]),
      ],
    );
    expect(result.top).toHaveLength(1);
    expect(result.top[0]).toMatchObject({ start: "09:30", end: "11:30", durationMinutes: 120 });
  });

  it("surfaces the nested {A,B} 9-12 overlap when A is 9-21 and B is 9-12", () => {
    // The 2-player overlap surfaces as the top window. The 1-player near-miss
    // is the COMPLEMENT — only the 12-21 stretch where A is alone — never the
    // 9-12 portion that overlaps with the top.
    const result = rankWindows(
      { candidateDates: [DATE], minBlockMinutes: 120, minPlayers: 2 },
      [
        member("a", "Alice", [{ start: "09:00", end: "21:00" }]),
        member("b", "Bob",   [{ start: "09:00", end: "12:00" }]),
      ],
    );
    expect(result.top).toHaveLength(1);
    expect(result.top[0]).toMatchObject({
      date: DATE,
      start: "09:00",
      end: "12:00",
      durationMinutes: 180,
    });
    expect(result.top[0].memberNames).toEqual(["Alice", "Bob"]);
    expect(result.nearMiss).toHaveLength(1);
    expect(result.nearMiss[0]).toMatchObject({
      date: DATE,
      start: "12:00",
      end: "21:00",
      durationMinutes: 540,
    });
    expect(result.nearMiss[0].memberNames).toEqual(["Alice"]);
  });

  it("subtracts higher-population coverage from cascading nested members", () => {
    // A 9-21, B 10-20, C 11-15.
    // - {A,B,C} 11-15 stays (no strict superset).
    // - {A,B} 10-20 minus {A,B,C} 11-15 → [10,11) + [15,20). [10,11) is 1h
    //   (below 2h floor, drops); [15,20) is 5h (kept).
    // - {A} 9-21 minus {A,B,C} 11-15 ∪ {A,B} 10-20 = 9-21 minus [10,20) →
    //   [9,10) + [20,21). Both 1h, both drop.
    const result = rankWindows(
      { candidateDates: [DATE], minBlockMinutes: 120, minPlayers: 1 },
      [
        member("a", "Alice",   [{ start: "09:00", end: "21:00" }]),
        member("b", "Bob",     [{ start: "10:00", end: "20:00" }]),
        member("c", "Carol",   [{ start: "11:00", end: "15:00" }]),
      ],
    );
    expect(result.top).toHaveLength(2);
    expect(result.top[0]).toMatchObject({
      start: "11:00", end: "15:00", durationMinutes: 240,
    });
    expect(result.top[0].memberNames).toEqual(["Alice", "Bob", "Carol"]);
    expect(result.top[1]).toMatchObject({
      start: "15:00", end: "20:00", durationMinutes: 300,
    });
    expect(result.top[1].memberNames).toEqual(["Alice", "Bob"]);
  });

  it("near-miss never overlaps the top window time-wise", () => {
    // Pins the semantic invariant: any near-miss window's time range must lie
    // entirely outside every top window on the same date (no redundancy).
    const result = rankWindows(
      { candidateDates: [DATE], minBlockMinutes: 120, minPlayers: 2 },
      [
        member("a", "Alice", [{ start: "09:00", end: "21:00" }]),
        member("b", "Bob",   [{ start: "09:00", end: "12:00" }]),
      ],
    );
    for (const top of result.top) {
      for (const nm of result.nearMiss) {
        if (top.date !== nm.date) continue;
        const overlap = !(nm.end <= top.start || nm.start >= top.end);
        expect(overlap).toBe(false);
      }
    }
  });
});

describe("validateBlock", () => {
  it("flags missing date", () => {
    expect(validateBlock({ date: "", start: "09:00", end: "11:00" }, 120)).toMatch(/date/i);
  });
  it("flags reversed times", () => {
    expect(validateBlock({ date: DATE, start: "11:00", end: "09:00" }, 120)).toMatch(/after start/i);
  });
  it("flags sub-minimum duration", () => {
    expect(validateBlock({ date: DATE, start: "09:00", end: "10:00" }, 120)).toMatch(/2 hours/);
  });
  it("accepts a valid 2h block", () => {
    expect(validateBlock({ date: DATE, start: "09:00", end: "11:00" }, 120)).toBeNull();
  });
});
