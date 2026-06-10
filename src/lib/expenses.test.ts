import { describe, it, expect } from "vitest";
import {
  seedEqualShares,
  sumAmounts,
  remainingCents,
  computeColumnNet,
  computeNetTotals,
  withoutSettled,
  settleUp,
  type ColumnLike,
} from "./expenses";

describe("withoutSettled", () => {
  it("drops settled members from both payments and shares", () => {
    const col: ColumnLike = {
      payments: [
        { userId: "anna", amountCents: 3000 },
        { userId: "ben", amountCents: 2000 },
      ],
      shares: [
        { userId: "anna", amountCents: 1667 },
        { userId: "ben", amountCents: 1667 },
        { userId: "cara", amountCents: 1666 },
      ],
    };
    const out = withoutSettled(col, ["cara"]);
    expect(out.payments).toHaveLength(2);
    expect(out.shares.map((s) => s.userId)).toEqual(["anna", "ben"]);
    // Cara's owed no longer counts toward anyone's running total.
    const net = computeColumnNet(out);
    expect(net.has("cara")).toBe(false);
  });

  it("returns the column unchanged when nothing is settled", () => {
    const col: ColumnLike = { payments: [{ userId: "a", amountCents: 100 }], shares: [{ userId: "a", amountCents: 100 }] };
    expect(withoutSettled(col, [])).toEqual(col);
  });
});

describe("seedEqualShares", () => {
  it("splits evenly when divisible", () => {
    expect(seedEqualShares(900, ["a", "b", "c"]).map((s) => s.amountCents)).toEqual([300, 300, 300]);
  });
  it("distributes the remainder one cent at a time", () => {
    const shares = seedEqualShares(1000, ["a", "b", "c"]);
    expect(shares.map((s) => s.amountCents)).toEqual([334, 333, 333]);
    expect(sumAmounts(shares)).toBe(1000);
  });
  it("returns nothing for an empty participant list", () => {
    expect(seedEqualShares(1000, [])).toEqual([]);
  });
});

describe("remainingCents", () => {
  it("zero for a valid custom split", () => {
    expect(remainingCents(1000, [{ userId: "a", amountCents: 600 }, { userId: "b", amountCents: 400 }])).toBe(0);
  });
  it("positive when under-allocated, negative when over", () => {
    expect(remainingCents(1000, [{ userId: "a", amountCents: 700 }])).toBe(300);
    expect(remainingCents(1000, [{ userId: "a", amountCents: 1200 }])).toBe(-200);
  });
});

describe("computeColumnNet", () => {
  it("nets a single-payer event split among participants", () => {
    // Anna paid $30; participants Anna/Ben/Cara each owe $10.
    const col: ColumnLike = {
      payments: [{ userId: "anna", amountCents: 3000 }],
      shares: [
        { userId: "anna", amountCents: 1000 },
        { userId: "ben", amountCents: 1000 },
        { userId: "cara", amountCents: 1000 },
      ],
    };
    const net = computeColumnNet(col);
    expect(net.get("anna")).toBe(-2000); // owes 1000, paid 3000 → receives 2000
    expect(net.get("ben")).toBe(1000);
    expect(net.get("cara")).toBe(1000);
    expect([...net.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("handles MULTIPLE payers in one column", () => {
    // Total $50: Anna paid $30, Ben paid $20. Participants Anna/Ben/Cara, $50/3.
    const col: ColumnLike = {
      payments: [
        { userId: "anna", amountCents: 3000 },
        { userId: "ben", amountCents: 2000 },
      ],
      shares: seedEqualShares(5000, ["anna", "ben", "cara"]), // 1667/1667/1666
    };
    const net = computeColumnNet(col);
    expect(net.get("anna")).toBe(1667 - 3000); // -1333
    expect(net.get("ben")).toBe(1667 - 2000); // -333
    expect(net.get("cara")).toBe(1666 - 0); // 1666
    expect([...net.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("a payer who is not a participant only receives", () => {
    // Coach paid $20, doesn't play; Ben/Cara split it.
    const col: ColumnLike = {
      payments: [{ userId: "coach", amountCents: 2000 }],
      shares: [
        { userId: "ben", amountCents: 1000 },
        { userId: "cara", amountCents: 1000 },
      ],
    };
    const net = computeColumnNet(col);
    expect(net.get("coach")).toBe(-2000);
    expect(net.get("ben")).toBe(1000);
    expect(net.get("cara")).toBe(1000);
  });
});

describe("computeNetTotals", () => {
  it("sums each member's net across columns", () => {
    const columns: ColumnLike[] = [
      {
        payments: [{ userId: "anna", amountCents: 3000 }],
        shares: seedEqualShares(3000, ["anna", "ben", "cara"]), // 1000 each
      },
      {
        payments: [{ userId: "ben", amountCents: 2000 }],
        shares: seedEqualShares(2000, ["ben", "cara"]), // 1000 each
      },
    ];
    const t = computeNetTotals(columns);
    expect(t.get("anna")).toBe(-2000); // owed 1000, paid 3000
    expect(t.get("ben")).toBe(0); // owed 1000+1000, paid 2000
    expect(t.get("cara")).toBe(2000); // owed 1000+1000, paid 0
    expect([...t.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("is empty for no columns", () => {
    expect(computeNetTotals([]).size).toBe(0);
  });
});

describe("settleUp", () => {
  it("produces transfers that zero everyone out", () => {
    // cara owes 2000; anna receives 2000.
    const totals = new Map([["anna", -2000], ["ben", 0], ["cara", 2000]]);
    const transfers = settleUp(totals);
    expect(transfers).toEqual([{ fromId: "cara", toId: "anna", amountCents: 2000 }]);
  });

  it("greedily matches largest debtor to largest creditor", () => {
    // debtors: c=3000, d=1000 ; creditors: a=2500, b=1500
    const totals = new Map([
      ["a", -2500],
      ["b", -1500],
      ["c", 3000],
      ["d", 1000],
    ]);
    const transfers = settleUp(totals);
    // Net effect: every balance returns to zero.
    const applied = new Map<string, number>(totals);
    for (const t of transfers) {
      applied.set(t.fromId, (applied.get(t.fromId) ?? 0) - t.amountCents);
      applied.set(t.toId, (applied.get(t.toId) ?? 0) + t.amountCents);
    }
    expect([...applied.values()].every((v) => v === 0)).toBe(true);
    // Largest debtor c pays the largest creditor a first.
    expect(transfers[0]).toEqual({ fromId: "c", toId: "a", amountCents: 2500 });
  });

  it("returns nothing when all settled", () => {
    expect(settleUp(new Map([["a", 0], ["b", 0]]))).toEqual([]);
  });
});
