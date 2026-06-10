import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  deleteTestUsers,
  integrationEnvReady,
  makeTestUser,
  type TestUser,
} from "./_helpers";
import {
  createGroupExpenseColumn,
  updateGroupExpenseColumn,
  deleteGroupExpenseColumn,
  listGroupExpenseColumns,
  setCellsSettled,
  type ExpenseColumn,
} from "@/lib/supabase/queries/expenses";
import { computeColumnNet, computeNetTotals, withoutSettled, type ColumnLike } from "@/lib/expenses";

// Live-Supabase coverage for the team Expenses feature (migrations 0013–0017):
// group-scoped expenses + RLS, multiple payers (expense_payments), per-cell
// settling (expense_settlements via the set_expense_cells_settled RPC), and the
// CHECK constraints that keep the in-chat "Split a cost" flow intact.
//
// Personas:
//   alice — group owner (captain via ownership)
//   bob   — member; creates the column and is a payer
//   carol — member; participant + payer
//   cap   — member with the captain role (NOT involved in any bill)
//   eve   — plain member, NOT involved in any bill
//   dave  — non-member

function toColLike(c: ExpenseColumn): ColumnLike {
  return {
    payments: c.payments.map((p) => ({ userId: p.user_id, amountCents: p.amount_cents })),
    shares: c.shares.map((s) => ({ userId: s.user_id, amountCents: s.amount_cents })),
  };
}

describe.skipIf(!integrationEnvReady)("team expenses (live Supabase)", () => {
  let alice: TestUser, bob: TestUser, carol: TestUser, cap: TestUser, eve: TestUser, dave: TestUser;
  let groupId: string;
  let columnId: string;

  beforeAll(async () => {
    [alice, bob, carol, cap, eve, dave] = await Promise.all([
      makeTestUser("exp-alice"),
      makeTestUser("exp-bob"),
      makeTestUser("exp-carol"),
      makeTestUser("exp-cap"),
      makeTestUser("exp-eve"),
      makeTestUser("exp-dave"),
    ]);
    const admin = adminClient();
    const { data: g } = await admin
      .from("groups")
      .insert({ name: "Expense Test Team", owner_id: alice.id })
      .select("id")
      .single();
    groupId = g!.id;
    // owner row auto-added by trigger; add the rest. cap gets the captain role
    // (INSERT isn't guarded — only UPDATE is).
    await admin.from("group_members").insert([
      { group_id: groupId, user_id: bob.id, roles: [] },
      { group_id: groupId, user_id: carol.id, roles: [] },
      { group_id: groupId, user_id: cap.id, roles: ["captain"] },
      { group_id: groupId, user_id: eve.id, roles: [] },
    ]);
  }, 60_000);

  afterAll(async () => {
    if (groupId) await adminClient().from("groups").delete().eq("id", groupId);
    await deleteTestUsers([alice, bob, carol, cap, eve, dave].filter(Boolean));
  }, 60_000);

  it("any member can add a column; non-member cannot; created_by must be self", async () => {
    // bob (plain member) creates a multi-payer column: bob $30 + carol $20 = $50,
    // split equally among bob/carol/alice (1667/1667/1666).
    columnId = await createGroupExpenseColumn(bob.client, {
      groupId,
      sourceKind: "custom",
      eventLabel: "Court + balls",
      amountCents: 5000,
      payments: [
        { userId: bob.id, amountCents: 3000 },
        { userId: carol.id, amountCents: 2000 },
      ],
      shares: [
        { userId: bob.id, amountCents: 1667 },
        { userId: carol.id, amountCents: 1667 },
        { userId: alice.id, amountCents: 1666 },
      ],
    });
    expect(columnId).toBeTruthy();

    // Non-member dave cannot create a column in this group.
    await expect(
      createGroupExpenseColumn(dave.client, {
        groupId,
        sourceKind: "custom",
        eventLabel: "hack",
        amountCents: 100,
        payments: [{ userId: dave.id, amountCents: 100 }],
        shares: [{ userId: dave.id, amountCents: 100 }],
      })
    ).rejects.toBeTruthy();

    // The insert policy requires created_by_id = auth.uid(): bob can't stamp carol.
    const spoof = await bob.client
      .from("expenses")
      .insert({
        group_id: groupId,
        created_by_id: carol.id,
        payer_id: null,
        amount_cents: 100,
        source_kind: "custom",
        event_label: "spoof",
      })
      .select("id");
    expect(spoof.error).not.toBeNull();
  });

  it("multiple payers split correctly and net is conserved", async () => {
    const cols = await listGroupExpenseColumns(bob.client, groupId);
    const col = cols.find((c) => c.id === columnId)!;
    expect(col.amount_cents).toBe(5000);
    expect(col.payments).toHaveLength(2);
    expect(col.shares).toHaveLength(3);

    const net = computeColumnNet(toColLike(col));
    expect(net.get(alice.id)).toBe(1666); // owes 1666, paid 0 → pays
    expect(net.get(bob.id)).toBe(1667 - 3000); // -1333 → receives
    expect(net.get(carol.id)).toBe(1667 - 2000); // -333 → receives
    expect([...net.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("members can read the column; non-members cannot", async () => {
    const carolView = await listGroupExpenseColumns(carol.client, groupId);
    expect(carolView.some((c) => c.id === columnId)).toBe(true);
    // payments + settlements are also readable by a member.
    expect(carolView.find((c) => c.id === columnId)!.payments.length).toBe(2);

    const daveView = await listGroupExpenseColumns(dave.client, groupId);
    expect(daveView).toHaveLength(0);
  });

  it("only the creator or a captain can edit a column", async () => {
    // carol is a plain member who didn't create it → cannot edit.
    await expect(
      updateGroupExpenseColumn(carol.client, columnId, {
        amountCents: 9999,
        payments: [{ userId: carol.id, amountCents: 9999 }],
        shares: [{ userId: carol.id, amountCents: 9999 }],
      })
    ).rejects.toBeTruthy();

    // cap (captain) can edit — restore the original numbers.
    await updateGroupExpenseColumn(cap.client, columnId, {
      amountCents: 5000,
      payments: [
        { userId: bob.id, amountCents: 3000 },
        { userId: carol.id, amountCents: 2000 },
      ],
      shares: [
        { userId: bob.id, amountCents: 1667 },
        { userId: carol.id, amountCents: 1667 },
        { userId: alice.id, amountCents: 1666 },
      ],
    });
    const cols = await listGroupExpenseColumns(cap.client, groupId);
    expect(cols.find((c) => c.id === columnId)!.amount_cents).toBe(5000);
  });

  it("settling: involved member settles own cell; non-involved is a no-op; captain can settle", async () => {
    // carol is involved → can settle her own cell.
    await setCellsSettled(carol.client, [{ expenseId: columnId, userId: carol.id }], true);
    let col = (await listGroupExpenseColumns(carol.client, groupId)).find((c) => c.id === columnId)!;
    expect(col.settled_user_ids).toContain(carol.id);

    // eve is a member but NOT involved in this bill → her settle attempt is skipped.
    await setCellsSettled(eve.client, [{ expenseId: columnId, userId: alice.id }], true);
    col = (await listGroupExpenseColumns(eve.client, groupId)).find((c) => c.id === columnId)!;
    expect(col.settled_user_ids).not.toContain(alice.id);

    // cap (captain) can settle anyone's cell even though uninvolved.
    await setCellsSettled(cap.client, [{ expenseId: columnId, userId: alice.id }], true);
    col = (await listGroupExpenseColumns(cap.client, groupId)).find((c) => c.id === columnId)!;
    expect(col.settled_user_ids).toEqual(expect.arrayContaining([carol.id, alice.id]));
  });

  it("settled cells drop out of running net totals", async () => {
    const cols = await listGroupExpenseColumns(bob.client, groupId);
    // carol + alice cells are settled (previous test) → only bob remains.
    const totals = computeNetTotals(cols.map((c) => withoutSettled(toColLike(c), c.settled_user_ids)));
    expect(totals.has(carol.id)).toBe(false);
    expect(totals.has(alice.id)).toBe(false);
    expect(totals.get(bob.id)).toBe(1667 - 3000); // bob's own share/payment remain
  });

  it("creator can delete a column; another plain member cannot", async () => {
    const tempId = await createGroupExpenseColumn(bob.client, {
      groupId,
      sourceKind: "custom",
      eventLabel: "Snacks",
      amountCents: 1000,
      payments: [{ userId: bob.id, amountCents: 1000 }],
      shares: [{ userId: bob.id, amountCents: 1000 }],
    });
    // carol (not creator, not captain) cannot delete.
    await deleteGroupExpenseColumn(carol.client, tempId);
    let cols = await listGroupExpenseColumns(bob.client, groupId);
    expect(cols.some((c) => c.id === tempId)).toBe(true); // still there

    // bob (creator) can.
    await deleteGroupExpenseColumn(bob.client, tempId);
    cols = await listGroupExpenseColumns(bob.client, groupId);
    expect(cols.some((c) => c.id === tempId)).toBe(false);
  });

  it("CHECK constraints keep chat vs group scoping sound (chat flow intact)", async () => {
    const admin = adminClient();
    // A normal chat expense (single payer, no group) still inserts.
    const { data: chat } = await admin
      .from("chats")
      .insert({ name: "exp-chat", creator_id: alice.id })
      .select("id")
      .single();
    const chatId = chat!.id;
    try {
      const okChat = await admin
        .from("expenses")
        .insert({ chat_id: chatId, payer_id: alice.id, amount_cents: 1000, description: "balls" })
        .select("id")
        .single();
      expect(okChat.error).toBeNull();

      // Neither chat nor group → scope check rejects.
      const neither = await admin
        .from("expenses")
        .insert({ payer_id: alice.id, amount_cents: 100 })
        .select("id");
      expect(neither.error).not.toBeNull();

      // Chat expense with no payer → chat_payer_check rejects.
      const noPayer = await admin
        .from("expenses")
        .insert({ chat_id: chatId, payer_id: null, amount_cents: 100 })
        .select("id");
      expect(noPayer.error).not.toBeNull();

      // Group expense claiming a match source but no match_id → group_source_check rejects.
      const badSource = await admin
        .from("expenses")
        .insert({
          group_id: groupId,
          created_by_id: alice.id,
          payer_id: null,
          amount_cents: 100,
          source_kind: "match",
          match_id: null,
        })
        .select("id");
      expect(badSource.error).not.toBeNull();
    } finally {
      // chats.creator_id is ON DELETE RESTRICT, so remove the chat before teardown.
      await admin.from("chats").delete().eq("id", chatId);
    }
  });
});
