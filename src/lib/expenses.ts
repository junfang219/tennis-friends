// Pure expense-splitting math for the team Expenses tab. Kept free of any
// Supabase/React imports so it's trivially unit-testable. Money is integer cents.
//
// Model: each "column" is one event (match/practice/custom). Its total is the
// sum of everyone's payments; the total is split among the marked participants
// (shares). A member's NET for the column is what they owe minus what they paid:
//   net > 0  → they should PAY
//   net < 0  → they should RECEIVE
//   net = 0  → square

import { splitEqualCents } from "./payment";

export interface AmountByUser {
  userId: string;
  amountCents: number;
}

// A participant's owed share and a payer's payment share the same shape.
export type ExpenseShareLike = AmountByUser;
export type PaymentLike = AmountByUser;

export interface ColumnLike {
  payments: PaymentLike[]; // who paid how much
  shares: ExpenseShareLike[]; // marked participants' owed amounts (sum = total)
}

/**
 * Equal split of `totalCents` across `participantIds`, distributing the
 * rounding remainder one cent at a time so the shares sum exactly to the total
 * (e.g. 1000 / 3 → 334, 333, 333).
 */
export function seedEqualShares(
  totalCents: number,
  participantIds: string[]
): ExpenseShareLike[] {
  const amounts = splitEqualCents(totalCents, participantIds.length);
  return participantIds.map((userId, i) => ({ userId, amountCents: amounts[i] ?? 0 }));
}

export function sumAmounts(rows: AmountByUser[]): number {
  return rows.reduce((acc, r) => acc + r.amountCents, 0);
}

/**
 * For a custom (hand-edited) split: cents still unallocated. Must be 0 before a
 * column can be saved. Negative if over-allocated.
 */
export function remainingCents(totalCents: number, shares: ExpenseShareLike[]): number {
  return totalCents - sumAmounts(shares);
}

/** Net per member for one column: owed share − amount paid. */
export function computeColumnNet(col: ColumnLike): Map<string, number> {
  const net = new Map<string, number>();
  const bump = (id: string, delta: number) => net.set(id, (net.get(id) ?? 0) + delta);
  for (const s of col.shares) bump(s.userId, s.amountCents);
  for (const p of col.payments) bump(p.userId, -p.amountCents);
  return net;
}

/** Net per member summed across every column (the "Total" column). */
export function computeNetTotals(columns: ColumnLike[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const col of columns) {
    for (const [id, n] of computeColumnNet(col)) {
      totals.set(id, (totals.get(id) ?? 0) + n);
    }
  }
  return totals;
}

export interface Transfer {
  fromId: string; // debtor (pays)
  toId: string; // creditor (receives)
  amountCents: number;
}

/**
 * Minimal set of transfers that settles the given net balances, greedily
 * matching the largest debtor against the largest creditor. `totals` uses the
 * net sign convention (positive = owes / pays). The transfers always net each
 * person to zero; the result is deterministic (ties broken by userId) so the UI
 * is stable across renders.
 */
export function settleUp(totals: Map<string, number>): Transfer[] {
  const debtors = [...totals.entries()]
    .filter(([, n]) => n > 0)
    .map(([id, n]) => ({ id, amt: n }))
    .sort((a, b) => b.amt - a.amt || a.id.localeCompare(b.id));
  const creditors = [...totals.entries()]
    .filter(([, n]) => n < 0)
    .map(([id, n]) => ({ id, amt: -n }))
    .sort((a, b) => b.amt - a.amt || a.id.localeCompare(b.id));

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    if (pay > 0) {
      transfers.push({ fromId: debtors[i].id, toId: creditors[j].id, amountCents: pay });
    }
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if (debtors[i].amt === 0) i++;
    if (creditors[j].amt === 0) j++;
  }
  return transfers;
}
