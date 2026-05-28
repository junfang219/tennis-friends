"use client";

import { useEffect, useState, useCallback } from "react";
import Avatar from "./Avatar";
import {
  buildPayIntent,
  dollarsString,
  PAYMENT_LABELS,
  type PaymentMethod,
} from "@/lib/payment";
import { openPayment } from "@/lib/openPayment";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  getMyProfile,
  updateMyProfile,
  sendChatMessage,
  updateExpenseChatMessage,
  PAYMENT_PROFILE_COLUMNS,
  type PaymentProfile,
} from "@/lib/supabase/queries";
import { errorMessage } from "@/lib/errorMessage";

type Participant = { id: string; name: string; profileImageUrl: string };

type Balance = {
  otherId: string;
  otherName: string;
  otherImage: string;
  netCents: number;
  paymentHandles: {
    venmoHandle: string | null;
    paypalHandle: string | null;
    cashappHandle: string | null;
    zelleHandle: string | null;
  };
};

type ExpenseShare = {
  id: string;
  userId: string;
  amountCents: number;
  settledAt: string | null;
  user: {
    id: string;
    name: string;
    profileImageUrl: string;
    venmoHandle: string | null;
    paypalHandle: string | null;
    cashappHandle: string | null;
    zelleHandle: string | null;
  };
};

type GuestShare = {
  id: string;
  guestName: string;
  amountCents: number;
  settledAt: string | null;
};

type GuestBalance = {
  guestName: string;
  amountCents: number;
  openShareIds: string[];
};

type Expense = {
  id: string;
  amountCents: number;
  description: string;
  createdAt: string;
  payer: {
    id: string;
    name: string;
    profileImageUrl: string;
    venmoHandle: string | null;
    paypalHandle: string | null;
    cashappHandle: string | null;
    zelleHandle: string | null;
  };
  shares: ExpenseShare[];
  guestShares: GuestShare[];
};

// Single source of truth for the expense announcement message format,
// used by both the create flow (handleSubmit) and the edit flow (saveEdit).
// Both must produce identical text for the same numbers so an edit
// looks like a clean rewrite of the original message.
function formatExpenseAnnouncement(opts: {
  amountCents: number;
  description: string;
  baseCents: number;
  playerCount: number;
  guestCount: number;
  edited?: boolean;
}): string {
  const splitParts = [
    `${opts.playerCount} ${opts.playerCount === 1 ? "player" : "players"}`,
    ...(opts.guestCount > 0
      ? [`${opts.guestCount} guest${opts.guestCount === 1 ? "" : "s"}`]
      : []),
  ];
  const lines = [
    opts.edited ? `💵 Expense updated` : `💵 Expense added`,
    `💰 $${dollarsString(opts.amountCents)}`,
    ...(opts.description.trim() ? [`📝 ${opts.description.trim()}`] : []),
    `👥 ~$${dollarsString(opts.baseCents)} each (${splitParts.join(" + ")})`,
  ];
  return lines.join("\n");
}

export default function SplitCostSheet({
  chatId,
  participants,
  guestNames,
  myId,
  keyboardHeight,
  onClose,
  onExpenseCreated,
}: {
  chatId: string;
  participants: Participant[];
  guestNames: string[];
  myId: string;
  // Passed in from the parent (chat page) instead of read via useKeyboardHeight
  // here. The parent's hook is already subscribed to Capacitor's keyboard
  // events by the time the user opens this sheet, so the very first
  // keyboardWillShow after the user taps an input is reliably observed.
  // A local useKeyboardHeight would miss it because the hook's async
  // addListener can resolve after the keyboard event has already fired.
  keyboardHeight: number;
  onClose: () => void;
  onExpenseCreated: () => void;
}) {
  const [tab, setTab] = useState<"add" | "balances">("add");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [guestBalances, setGuestBalances] = useState<GuestBalance[]>([]);
  const [myHandles, setMyHandles] = useState<{
    venmoHandle: string | null;
    paypalHandle: string | null;
    cashappHandle: string | null;
    zelleHandle: string | null;
  }>({ venmoHandle: null, paypalHandle: null, cashappHandle: null, zelleHandle: null });
  const [loadingData, setLoadingData] = useState(false);

  // Sticky lift: once the keyboard has raised the sheet, keep it there
  // even after the keyboard hides (e.g. when the user switches to the
  // Balances tab, which has no inputs). Without this, the sheet would
  // visibly drop back to the bottom of the screen on tab switch.
  const [liftPx, setLiftPx] = useState(0);
  useEffect(() => {
    if (keyboardHeight > liftPx) setLiftPx(keyboardHeight);
  }, [keyboardHeight, liftPx]);

  const load = useCallback(async () => {
    setLoadingData(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const [{ data: rawExpenses }, me] = await Promise.all([
        supabase
          .from("expenses")
          .select(
            `id, amount_cents, description, created_at,
             payer:profiles!expenses_payer_id_fkey ( ${PAYMENT_PROFILE_COLUMNS} ),
             shares:expense_shares (
               id, user_id, guest_name, amount_cents, settled_at,
               user:profiles ( ${PAYMENT_PROFILE_COLUMNS} )
             )`
          )
          .eq("chat_id", chatId)
          .order("created_at", { ascending: false }),
        getMyProfile(supabase),
      ]);

      type RawShare = {
        id: string;
        user_id: string | null;
        guest_name: string | null;
        amount_cents: number;
        settled_at: string | null;
        user: PaymentProfile | null;
      };
      type RawExpense = {
        id: string;
        amount_cents: number;
        description: string;
        created_at: string;
        payer: PaymentProfile;
        shares: RawShare[];
      };

      const exps = ((rawExpenses ?? []) as unknown as RawExpense[]).map((e) => ({
        id: e.id,
        amountCents: e.amount_cents,
        description: e.description,
        createdAt: e.created_at,
        payer: {
          id: e.payer.id,
          name: e.payer.name,
          profileImageUrl: e.payer.profile_image_url,
          venmoHandle: e.payer.venmo_handle,
          paypalHandle: e.payer.paypal_handle,
          cashappHandle: e.payer.cashapp_handle,
          zelleHandle: e.payer.zelle_handle,
        },
        shares: e.shares
          .filter((s) => s.user_id !== null && s.user !== null)
          .map((s) => ({
            id: s.id,
            userId: s.user_id!,
            amountCents: s.amount_cents,
            settledAt: s.settled_at,
            user: {
              id: s.user!.id,
              name: s.user!.name,
              profileImageUrl: s.user!.profile_image_url,
              venmoHandle: s.user!.venmo_handle,
              paypalHandle: s.user!.paypal_handle,
              cashappHandle: s.user!.cashapp_handle,
              zelleHandle: s.user!.zelle_handle,
            },
          })),
        guestShares: e.shares
          .filter((s) => s.guest_name !== null)
          .map((s) => ({
            id: s.id,
            guestName: s.guest_name!,
            amountCents: s.amount_cents,
            settledAt: s.settled_at,
          })),
      }));
      setExpenses(exps);

      // Net balances: for each user, sum (paid to others) – (owed to me)
      // across all unsettled shares. Same algorithm the deleted route used.
      const userTotals = new Map<string, { name: string; image: string; net: number; handles: Balance["paymentHandles"] }>();
      for (const e of exps) {
        const payerIsMe = e.payer.id === myId;
        for (const s of e.shares) {
          if (s.settledAt) continue;
          // Skip the payer's own share (they don't owe themselves).
          if (s.userId === e.payer.id) continue;
          if (payerIsMe) {
            // They owe me.
            const cur = userTotals.get(s.userId) ?? {
              name: s.user.name,
              image: s.user.profileImageUrl,
              net: 0,
              handles: {
                venmoHandle: s.user.venmoHandle,
                paypalHandle: s.user.paypalHandle,
                cashappHandle: s.user.cashappHandle,
                zelleHandle: s.user.zelleHandle,
              },
            };
            cur.net -= s.amountCents;
            userTotals.set(s.userId, cur);
          } else if (s.userId === myId) {
            // I owe payer.
            const cur = userTotals.get(e.payer.id) ?? {
              name: e.payer.name,
              image: e.payer.profileImageUrl,
              net: 0,
              handles: {
                venmoHandle: e.payer.venmoHandle,
                paypalHandle: e.payer.paypalHandle,
                cashappHandle: e.payer.cashappHandle,
                zelleHandle: e.payer.zelleHandle,
              },
            };
            cur.net += s.amountCents;
            userTotals.set(e.payer.id, cur);
          }
        }
      }
      setBalances(
        Array.from(userTotals.entries())
          .filter(([, v]) => v.net !== 0)
          .map(([otherId, v]) => ({
            otherId,
            otherName: v.name,
            otherImage: v.image,
            netCents: v.net,
            paymentHandles: v.handles,
          }))
      );

      // Guest balances: sum unsettled guest shares I'm responsible to collect.
      const guestTotals = new Map<string, { net: number; ids: string[] }>();
      for (const e of exps) {
        if (e.payer.id !== myId) continue;
        for (const gs of e.guestShares) {
          if (gs.settledAt) continue;
          const cur = guestTotals.get(gs.guestName) ?? { net: 0, ids: [] };
          cur.net += gs.amountCents;
          cur.ids.push(gs.id);
          guestTotals.set(gs.guestName, cur);
        }
      }
      setGuestBalances(
        Array.from(guestTotals.entries()).map(([guestName, v]) => ({
          guestName,
          amountCents: v.net,
          openShareIds: v.ids,
        }))
      );

      if (me) {
        setMyHandles({
          venmoHandle: me.venmo_handle,
          paypalHandle: me.paypal_handle,
          cashappHandle: me.cashapp_handle,
          zelleHandle: me.zelle_handle,
        });
      }
    } catch {}
    setLoadingData(false);
  }, [chatId, myId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const handleSubmit = async () => {
    setError("");
    const dollars = Number(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setError("Enter a positive amount.");
      return;
    }
    const cents = Math.round(dollars * 100);
    if (cents < 1) {
      setError("Amount too small.");
      return;
    }
    setSubmitting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: exp, error: insErr } = await supabase
        .from("expenses")
        .insert({
          chat_id: chatId,
          payer_id: myId,
          amount_cents: cents,
          description: description.trim(),
        })
        .select("id")
        .single();
      if (insErr || !exp) {
        setError(insErr?.message || "Could not save expense.");
        setSubmitting(false);
        return;
      }
      // Split the bill: equal share per participant + per guest.
      // Floor-divide then distribute the rounding remainder one cent at
      // a time to the first `remainder` slots so the shares sum to the
      // full amount (e.g. $10.00 / 3 → 3.34, 3.33, 3.33).
      const totalSlots = participants.length + guestNames.length;
      const baseCents = Math.floor(cents / totalSlots);
      const remainder = cents - baseCents * totalSlots;
      const slots: Array<{ user_id?: string; guest_name?: string }> = [
        ...participants.map((p) => ({ user_id: p.id })),
        ...guestNames.map((g) => ({ guest_name: g })),
      ];
      const shareRows = slots.map((slot, i) => ({
        expense_id: exp.id,
        ...slot,
        amount_cents: baseCents + (i < remainder ? 1 : 0),
      }));
      if (shareRows.length > 0) {
        await supabase.from("expense_shares").insert(shareRows);
      }

      // Announce the expense in the chat so other members see it without
      // having to open the Split sheet. Sent as a normal message under
      // the payer's identity, with expense_id set so a later edit can
      // rewrite this message. Best-effort: the expense is already saved,
      // so a failed notification shouldn't roll anything back.
      const announcement = formatExpenseAnnouncement({
        amountCents: cents,
        description,
        baseCents,
        playerCount: participants.length,
        guestCount: guestNames.length,
      });
      try {
        await sendChatMessage(supabase, chatId, announcement, { expenseId: exp.id });
      } catch {
        // Realtime won't fire; the expense is still in the DB and will
        // appear under Balances. User can re-share manually if needed.
      }

      setAmount("");
      setDescription("");
      await load();
      onExpenseCreated();
      setTab("balances");
    } catch (err) {
      setError(errorMessage(err, "Network error. Try again."));
    }
    setSubmitting(false);
  };

  const N = participants.length + guestNames.length;
  const perShareEstimate = amount && Number(amount) > 0 && N > 0
    ? `≈ $${dollarsString(Math.floor(Math.round(Number(amount) * 100) / N))} each`
    : "";
  const splitDescription = (() => {
    const playerCount = participants.length;
    const guestCount = guestNames.length;
    if (guestCount === 0) {
      return `among ${playerCount} ${playerCount === 1 ? "player" : "players"}`;
    }
    return `among ${playerCount} ${playerCount === 1 ? "player" : "players"} + ${guestCount} guest${guestCount === 1 ? "" : "s"}`;
  })();
  const namesDisplay = [
    ...participants.map((p) => p.name),
    ...guestNames.map((g) => `${g} (guest)`),
  ].join(", ");

  return (
    <div
      className="fixed inset-0 z-[10000] bg-black/50"
      onClick={onClose}
    >
      {/* Sheet uses absolute positioning so the bottom edge tracks the
          keyboard. On iOS, `fixed`/flex layouts compute against the
          layout viewport (full screen even with the keyboard open), so
          margin-on-flex-item tricks don't lift reliably. Anchoring with
          `bottom: keyboardHeight` is the same pattern the chat input
          bar uses and is the proven approach in this codebase. */}
      <div
        className="absolute left-0 right-0 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-md w-full bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{
          bottom: liftPx,
          maxHeight: `calc(90vh - ${liftPx}px)`,
        }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-display text-lg font-bold text-gray-900">Split a cost</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex border-b border-gray-100">
          <button
            onClick={() => setTab("add")}
            className={`flex-1 py-3 text-sm font-semibold transition-colors ${
              tab === "add"
                ? "text-court-green border-b-2 border-court-green"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Add expense
          </button>
          <button
            onClick={() => setTab("balances")}
            className={`flex-1 py-3 text-sm font-semibold transition-colors ${
              tab === "balances"
                ? "text-court-green border-b-2 border-court-green"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Balances
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === "add" ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Amount (USD)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-7 pr-3 py-2.5 border border-gray-200 rounded-xl text-base"
                    autoFocus
                  />
                </div>
                {perShareEstimate && (
                  <p className="text-xs text-gray-500 mt-1">{perShareEstimate}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Description</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Court fee, balls"
                  maxLength={200}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm"
                />
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-600">
                Splits equally {splitDescription}:{" "}
                <span className="font-medium text-gray-800">{namesDisplay}</span>
                {guestNames.length > 0 && (
                  <p className="text-[10px] text-gray-500 mt-1">
                    Guests aren&apos;t on Tennis Friends — collect their share in person.
                  </p>
                )}
              </div>
              {error && (
                <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                  {error}
                </div>
              )}
              <button
                onClick={handleSubmit}
                disabled={submitting || !amount}
                className="btn-primary w-full py-2.5"
              >
                {submitting ? "Saving..." : "Add expense"}
              </button>
            </div>
          ) : (
            <BalancesView
              loading={loadingData}
              balances={balances}
              guestBalances={guestBalances}
              expenses={expenses}
              chatId={chatId}
              myId={myId}
              myHandles={myHandles}
              onHandlesSaved={load}
              reload={load}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function BalancesView({
  loading,
  balances,
  guestBalances,
  expenses,
  chatId,
  myId,
  myHandles,
  onHandlesSaved,
  reload,
}: {
  loading: boolean;
  balances: Balance[];
  guestBalances: GuestBalance[];
  expenses: Expense[];
  chatId: string;
  myId: string;
  myHandles: {
    venmoHandle: string | null;
    paypalHandle: string | null;
    cashappHandle: string | null;
    zelleHandle: string | null;
  };
  onHandlesSaved: () => void;
  reload: () => void;
}) {
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // Launch the user's payment app of choice. The debtor can no longer
  // mark themselves settled — only the creditor can (see settleBalance).
  // So this is purely a convenience launcher; we don't track the return.
  const handlePayClick = async (b: Balance, method: PaymentMethod) => {
    const handleField = `${method}Handle` as const;
    const rawHandle = b.paymentHandles[handleField];
    if (!rawHandle || !rawHandle.trim()) return;
    const note = "Tennis Friends — court costs";
    const cents = Math.abs(b.netCents);
    const intent = buildPayIntent(method, rawHandle.trim(), cents, note);
    const result = await openPayment(intent);
    if (result.kind === "copied") {
      setToast(`Copied: ${result.text}. Open your bank's Zelle to send.`);
    }
  };

  const [guestSettling, setGuestSettling] = useState<string | null>(null);
  // Per-balance in-flight flag for the Mark-as-settled button. Keyed by
  // the other user's id so only one row's button shows a spinner state.
  const [settlingBalanceId, setSettlingBalanceId] = useState<string | null>(null);
  // Inline edit state for a History row. Only the payer can edit/delete.
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editError, setEditError] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const settleGuest = async (g: GuestBalance) => {
    setGuestSettling(g.guestName);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase
        .from("expense_shares")
        .update({ settled_at: new Date().toISOString() })
        .in("id", g.openShareIds);
      // Announce in chat so the group has a record of the guest paying.
      try {
        await sendChatMessage(
          supabase,
          chatId,
          `✅ Marked $${dollarsString(g.amountCents)} from ${g.guestName} (guest) as paid`,
        );
      } catch {
        // Settlement persisted; missing announcement isn't fatal.
      }
      reload();
    } catch {}
    setGuestSettling(null);
  };

  // Settle ALL unsettled shares between me and `b.otherId` in both
  // directions (shares I owe them + shares they owe me). Only the
  // creditor sees the button that invokes this — the debtor can't
  // unilaterally declare themselves paid.
  // RLS allows both updates via expense_shares_update_self_or_payer:
  // I own my shares (user_id = me) and I'm payer on theirs (payer_id = me).
  const settleBalance = async (b: Balance) => {
    if (!confirm(`Mark all unsettled expenses with ${b.otherName} as settled?`)) return;
    const shareIds = expenses
      .flatMap((e) => {
        if (e.payer.id !== myId && e.payer.id !== b.otherId) return [];
        return e.shares.filter(
          (s) =>
            !s.settledAt &&
            ((e.payer.id === b.otherId && s.userId === myId) ||
              (e.payer.id === myId && s.userId === b.otherId)),
        );
      })
      .map((s) => s.id);
    if (shareIds.length === 0) return;
    setSettlingBalanceId(b.otherId);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase
        .from("expense_shares")
        .update({ settled_at: new Date().toISOString() })
        .in("id", shareIds);
      // Announce in chat so both parties have a record of the settlement.
      try {
        await sendChatMessage(
          supabase,
          chatId,
          `✅ Marked $${dollarsString(Math.abs(b.netCents))} from ${b.otherName} as paid`,
        );
      } catch {
        // Settlement persisted; missing announcement isn't fatal.
      }
      reload();
    } catch {}
    setSettlingBalanceId(null);
  };

  const startEdit = (e: Expense) => {
    setEditingExpenseId(e.id);
    setEditAmount((e.amountCents / 100).toFixed(2));
    setEditDescription(e.description);
    setEditError("");
  };

  const cancelEdit = () => {
    setEditingExpenseId(null);
    setEditAmount("");
    setEditDescription("");
    setEditError("");
  };

  // Save an edited expense: update the amount/description and rewrite
  // every share's amount using the same floor + remainder distribution
  // used at create time. Resets settled_at on every share — once the
  // total changes, any "paid" status from the old amount is stale.
  const saveEdit = async (e: Expense) => {
    setEditError("");
    const dollars = Number(editAmount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setEditError("Enter a positive amount.");
      return;
    }
    const cents = Math.round(dollars * 100);
    if (cents < 1) {
      setEditError("Amount too small.");
      return;
    }
    const slots: { id: string }[] = [
      ...e.shares.map((s) => ({ id: s.id })),
      ...e.guestShares.map((g) => ({ id: g.id })),
    ];
    if (slots.length === 0) {
      setEditError("No shares to update.");
      return;
    }
    const baseCents = Math.floor(cents / slots.length);
    const remainder = cents - baseCents * slots.length;

    setEditBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: upErr } = await supabase
        .from("expenses")
        .update({ amount_cents: cents, description: editDescription.trim() })
        .eq("id", e.id);
      if (upErr) {
        setEditError(upErr.message);
        setEditBusy(false);
        return;
      }
      // Per-share updates in parallel — RLS allows the payer to update
      // any share whose parent expense they own.
      await Promise.all(
        slots.map((slot, i) =>
          supabase
            .from("expense_shares")
            .update({
              amount_cents: baseCents + (i < remainder ? 1 : 0),
              settled_at: null,
            })
            .eq("id", slot.id),
        ),
      );

      // Rewrite the companion chat_message (matched via expense_id) so
      // the announcement reflects the new numbers. Player + guest counts
      // are taken from the existing shares, not the parent component's
      // current chat membership, so a roster change doesn't retro-edit
      // an old expense's wording. Best-effort: if no companion message
      // exists (e.g. the original send failed) this is a no-op.
      const playerCount = e.shares.length;
      const guestCount = e.guestShares.length;
      const newContent = formatExpenseAnnouncement({
        amountCents: cents,
        description: editDescription,
        baseCents,
        playerCount,
        guestCount,
        edited: true,
      });
      try {
        await updateExpenseChatMessage(supabase, e.id, newContent);
      } catch {
        // Leave the original message intact if rewrite fails; the
        // expense data itself is the source of truth.
      }

      cancelEdit();
      reload();
    } catch (err) {
      setEditError(errorMessage(err, "Network error."));
    }
    setEditBusy(false);
  };

  const deleteExpense = async (e: Expense) => {
    if (!confirm(`Delete this expense ($${dollarsString(e.amountCents)}${e.description ? " — " + e.description : ""})? This can't be undone.`)) return;
    setEditBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      // expense_shares cascade-deletes via the FK.
      await supabase.from("expenses").delete().eq("id", e.id);
      reload();
    } catch {}
    setEditBusy(false);
  };

  if (loading) {
    return (
      <div className="text-center py-10 text-sm text-gray-500">Loading...</div>
    );
  }
  if (expenses.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-sm text-gray-500">No expenses yet.</p>
        <p className="text-xs text-gray-400 mt-1">Add one to start tracking who owes what.</p>
      </div>
    );
  }

  // Sign convention from the balance accumulator above:
  //   netCents < 0  →  the other person owes me  (I'm owed)
  //   netCents > 0  →  I owe the other person   (I'm owing)
  const owed = balances.filter((b) => b.netCents < 0).reduce((s, b) => s - b.netCents, 0);
  const owing = balances.filter((b) => b.netCents > 0).reduce((s, b) => s + b.netCents, 0);

  return (
    <div className="space-y-4 relative">
      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-[10001] bg-gray-900 text-white text-xs font-medium px-3 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-green-50 rounded-xl p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-green-700">You're owed</p>
          <p className="text-xl font-bold text-green-700 mt-0.5">${dollarsString(owed)}</p>
        </div>
        <div className="bg-orange-50 rounded-xl p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-orange-700">You owe</p>
          <p className="text-xl font-bold text-orange-700 mt-0.5">${dollarsString(owing)}</p>
        </div>
      </div>

      {owed > 0 && (
        <PaymentSetupCard handles={myHandles} onSaved={onHandlesSaved} />
      )}

      {balances.length === 0 ? (
        <p className="text-center text-sm text-gray-500 py-4">All settled up. 🎾</p>
      ) : (
        <div className="space-y-2">
          {balances.map((b) => {
            const youOwe = b.netCents > 0;
            const cents = Math.abs(b.netCents);
            const availableMethods: PaymentMethod[] = youOwe
              ? (["venmo", "paypal", "cashapp", "zelle"] as PaymentMethod[]).filter(
                  (m) => (b.paymentHandles[`${m}Handle` as const] || "").trim().length > 0
                )
              : [];
            return (
              <div
                key={b.otherId}
                className={`rounded-xl p-3 border ${
                  youOwe ? "bg-orange-50/50 border-orange-200" : "bg-green-50/50 border-green-200"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Avatar name={b.otherName} image={b.otherImage} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{b.otherName}</p>
                    <p className="text-xs text-gray-600">
                      {youOwe ? "You owe" : "Owes you"}{" "}
                      <span className="font-bold">${dollarsString(cents)}</span>
                    </p>
                  </div>
                  {!youOwe && (
                    <button
                      onClick={() => settleBalance(b)}
                      disabled={settlingBalanceId === b.otherId}
                      className="bg-court-green text-white text-[11px] font-bold px-3 py-1.5 rounded-lg hover:bg-court-green-light disabled:opacity-50 shrink-0"
                    >
                      {settlingBalanceId === b.otherId ? "..." : "Mark as settled"}
                    </button>
                  )}
                </div>
                {youOwe && (
                  <div className="mt-2 space-y-1.5">
                    {availableMethods.length > 0 ? (
                      <>
                        <p className="text-[10px] uppercase tracking-wider font-bold text-gray-500">
                          Pay ${dollarsString(cents)} via
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {availableMethods.map((m) => (
                            <button
                              key={m}
                              onClick={() => handlePayClick(b, m)}
                              className="inline-flex items-center gap-1.5 bg-court-green text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-court-green-light transition-colors"
                              title={
                                m === "zelle"
                                  ? `Copy Zelle handle: ${b.paymentHandles.zelleHandle}`
                                  : `Open ${PAYMENT_LABELS[m]}`
                              }
                            >
                              {PAYMENT_LABELS[m]}
                            </button>
                          ))}
                        </div>
                        <p className="text-[10px] text-gray-500">
                          {b.otherName} will mark this settled when they receive payment.
                        </p>
                      </>
                    ) : (
                      <span className="text-xs text-gray-500 italic">
                        {b.otherName} hasn&apos;t added a payment handle. Pay them in person; they&apos;ll mark it settled.
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {guestBalances.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider font-bold text-gray-500">
            Guests · pay in person
          </p>
          {guestBalances.map((g) => (
            <div
              key={g.guestName}
              className="rounded-xl p-3 border bg-gray-50 border-gray-200"
            >
              <div className="flex items-center gap-3">
                <Avatar name={g.guestName} image="" size="md" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900 truncate">{g.guestName}</p>
                    <span className="text-[10px] font-bold text-gray-500 bg-white border border-gray-200 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                      Guest
                    </span>
                  </div>
                  <p className="text-xs text-gray-600">
                    Owes you <span className="font-bold">${dollarsString(g.amountCents)}</span>
                  </p>
                  <p className="text-[10px] text-gray-400">
                    Not on Tennis Friends — collect in person.
                  </p>
                </div>
                <button
                  onClick={() => settleGuest(g)}
                  disabled={guestSettling === g.guestName}
                  className="bg-court-green text-white text-[11px] font-bold px-3 py-1.5 rounded-lg hover:bg-court-green-light disabled:opacity-50 shrink-0"
                >
                  {guestSettling === g.guestName ? "..." : "Mark paid"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <details className="pt-2">
        <summary className="text-xs font-semibold text-gray-500 cursor-pointer">
          History ({expenses.length} {expenses.length === 1 ? "expense" : "expenses"})
        </summary>
        <div className="mt-2 space-y-2">
          {expenses.map((e) => {
            const iAmPayer = e.payer.id === myId;
            const isEditing = editingExpenseId === e.id;
            return (
            <div key={e.id} className="border border-gray-100 rounded-xl p-3 bg-white">
              {isEditing ? (
                <div className="mb-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">$</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0.01"
                      value={editAmount}
                      onChange={(ev) => setEditAmount(ev.target.value)}
                      placeholder="0.00"
                      className="w-24 px-2 py-1 border border-gray-200 rounded-lg text-sm"
                      autoFocus
                    />
                    <input
                      type="text"
                      value={editDescription}
                      onChange={(ev) => setEditDescription(ev.target.value)}
                      placeholder="Description"
                      maxLength={200}
                      className="flex-1 min-w-0 px-2 py-1 border border-gray-200 rounded-lg text-sm"
                    />
                  </div>
                  {editError && (
                    <p className="text-[11px] text-red-600">{editError}</p>
                  )}
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-gray-400">
                      Editing resets any &quot;paid&quot; status on this expense.
                    </p>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={cancelEdit}
                        disabled={editBusy}
                        className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => saveEdit(e)}
                        disabled={editBusy || !editAmount}
                        className="text-xs font-semibold text-court-green hover:text-court-green-light disabled:opacity-50"
                      >
                        {editBusy ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 mb-2">
                  <Avatar name={e.payer.name} image={e.payer.profileImageUrl} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {e.payer.name} paid ${dollarsString(e.amountCents)}
                    </p>
                    {e.description && (
                      <p className="text-xs text-gray-500 truncate">{e.description}</p>
                    )}
                  </div>
                  {iAmPayer && (
                    <>
                      <button
                        onClick={() => startEdit(e)}
                        disabled={editBusy}
                        title="Edit"
                        aria-label="Edit expense"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => deleteExpense(e)}
                        disabled={editBusy}
                        title="Delete"
                        aria-label="Delete expense"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              )}
              <div className="space-y-1">
                {/* Skip the payer's own share — they paid the whole bill,
                    so saying "Payer owes their share" double-counts.
                    History is informational only; settlement happens at
                    the Balance-row level (Mark as settled), not per-share. */}
                {e.shares.filter((s) => s.userId !== e.payer.id).map((s) => {
                  const settled = !!s.settledAt;
                  return (
                    <div
                      key={s.id}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className={settled ? "text-gray-400 line-through" : "text-gray-700"}>
                        {s.user.name} owes ${dollarsString(s.amountCents)}
                      </span>
                      {settled && (
                        <span className="text-[10px] font-bold text-green-700 bg-green-50 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                          Paid
                        </span>
                      )}
                    </div>
                  );
                })}
                {e.guestShares.map((g) => {
                  const settled = !!g.settledAt;
                  return (
                    <div
                      key={g.id}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className={settled ? "text-gray-400 line-through" : "text-gray-700"}>
                        {g.guestName} <span className="text-[10px] text-gray-400">(guest)</span> owes ${dollarsString(g.amountCents)}
                      </span>
                      {settled && (
                        <span className="text-[10px] font-bold text-green-700 bg-green-50 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                          Paid
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}

// PaymentMethod is re-exported only via type import to keep the component file self-contained.
export type { PaymentMethod };

const METHOD_PLACEHOLDERS: Record<PaymentMethod, string> = {
  venmo: "username (no @)",
  paypal: "PayPal.me username",
  cashapp: "$cashtag (no $)",
  zelle: "phone or email",
};

const METHOD_FIELDS: Record<PaymentMethod, "venmoHandle" | "paypalHandle" | "cashappHandle" | "zelleHandle"> = {
  venmo: "venmoHandle",
  paypal: "paypalHandle",
  cashapp: "cashappHandle",
  zelle: "zelleHandle",
};

function PaymentSetupCard({
  handles,
  onSaved,
}: {
  handles: {
    venmoHandle: string | null;
    paypalHandle: string | null;
    cashappHandle: string | null;
    zelleHandle: string | null;
  };
  onSaved: () => void;
}) {
  const setMethods = (Object.keys(METHOD_FIELDS) as PaymentMethod[]).filter(
    (m) => (handles[METHOD_FIELDS[m]] || "").trim().length > 0
  );
  const hasAny = setMethods.length > 0;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    venmoHandle: "",
    paypalHandle: "",
    cashappHandle: "",
    zelleHandle: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const openEditor = () => {
    setDraft({
      venmoHandle: handles.venmoHandle || "",
      paypalHandle: handles.paypalHandle || "",
      cashappHandle: handles.cashappHandle || "",
      zelleHandle: handles.zelleHandle || "",
    });
    setError("");
    setEditing(true);
  };

  const onSave = async () => {
    setSaving(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      await updateMyProfile(supabase, {
        venmo_handle: draft.venmoHandle.trim() || null,
        paypal_handle: draft.paypalHandle.trim() || null,
        cashapp_handle: draft.cashappHandle.trim() || null,
        zelle_handle: draft.zelleHandle.trim() || null,
      });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(errorMessage(err, "Network error."));
    }
    setSaving(false);
  };

  if (!editing) {
    return (
      <div className="rounded-xl border border-court-green-pale/40 bg-court-green-pale/10 p-3">
        {hasAny ? (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-court-green">
                Your payment handles
              </p>
              <p className="text-[11px] text-gray-600 truncate">
                {setMethods.map((m) => PAYMENT_LABELS[m]).join(", ")}
              </p>
            </div>
            <button
              onClick={openEditor}
              className="text-[11px] font-semibold text-court-green hover:text-court-green-light px-2 py-1 rounded-md hover:bg-white/60 shrink-0"
            >
              Edit
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-court-green">
                Set up payment handles
              </p>
              <p className="text-[11px] text-gray-600">
                So players can pay you back via Venmo, PayPal, Cash App, or Zelle.
              </p>
            </div>
            <button
              onClick={openEditor}
              className="bg-court-green text-white text-[11px] font-bold px-3 py-1.5 rounded-lg hover:bg-court-green-light shrink-0"
            >
              Set up
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-court-green-pale/40 bg-white p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-700">Payment handles</p>
        <button
          onClick={() => setEditing(false)}
          className="text-[11px] text-gray-400 hover:text-gray-600"
        >
          Cancel
        </button>
      </div>
      <p className="text-[11px] text-gray-500">
        Fill in any you have. Empty fields are removed. Debtors will see a button per filled method.
      </p>
      {(Object.keys(METHOD_FIELDS) as PaymentMethod[]).map((m) => {
        const field = METHOD_FIELDS[m];
        return (
          <div key={m}>
            <label className="block text-[11px] font-semibold text-gray-700 mb-1">
              {PAYMENT_LABELS[m]}
            </label>
            <input
              type="text"
              value={draft[field]}
              onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
              placeholder={METHOD_PLACEHOLDERS[m]}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>
        );
      })}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        onClick={onSave}
        disabled={saving}
        className="bg-court-green text-white text-xs font-bold px-3 py-2 rounded-lg hover:bg-court-green-light disabled:opacity-50 w-full"
      >
        {saving ? "Saving..." : "Save all"}
      </button>
    </div>
  );
}
