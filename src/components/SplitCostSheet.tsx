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
  payer: { id: string; name: string; profileImageUrl: string };
  shares: ExpenseShare[];
  guestShares: GuestShare[];
};

export default function SplitCostSheet({
  chatId,
  participants,
  guestNames,
  myId,
  onClose,
  onExpenseCreated,
}: {
  chatId: string;
  participants: Participant[];
  guestNames: string[];
  myId: string;
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
  const [settling, setSettling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadingData(true);
    try {
      const res = await fetch(`/api/chats/${chatId}/expenses`);
      if (res.ok) {
        const data = await res.json();
        setExpenses(data.expenses || []);
        setBalances(data.balances || []);
        setGuestBalances(data.guestBalances || []);
        if (data.myHandles) setMyHandles(data.myHandles);
      }
    } catch {}
    setLoadingData(false);
  }, [chatId]);

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
      const res = await fetch(`/api/chats/${chatId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents: cents, description: description.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not save expense.");
        setSubmitting(false);
        return;
      }
      setAmount("");
      setDescription("");
      await load();
      onExpenseCreated();
      setTab("balances");
    } catch {
      setError("Network error. Try again.");
    }
    setSubmitting(false);
  };

  const toggleSettled = async (share: ExpenseShare, settled: boolean) => {
    setSettling(share.id);
    try {
      const res = await fetch(
        `/api/chats/${chatId}/expenses/shares/${share.id}/settle`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settled }),
        }
      );
      if (res.ok) await load();
    } catch {}
    setSettling(null);
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
      className="fixed inset-0 z-[10000] bg-black/50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
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
              onSettle={toggleSettled}
              onHandlesSaved={load}
              settlingId={settling}
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
  onSettle,
  onHandlesSaved,
  settlingId,
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
  onSettle: (share: ExpenseShare, settled: boolean) => void;
  onHandlesSaved: () => void;
  settlingId: string | null;
  reload: () => void;
}) {
  type PendingPay = {
    shareIds: string[];
    payeeName: string;
    payeeId: string;
    amountCents: number;
    method: PaymentMethod;
  };
  const [pendingPay, setPendingPay] = useState<PendingPay | null>(null);
  const [showReturnPrompt, setShowReturnPrompt] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!pendingPay) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") setShowReturnPrompt(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [pendingPay]);

  const handlePayClick = async (b: Balance, method: PaymentMethod) => {
    const handleField = `${method}Handle` as const;
    const rawHandle = b.paymentHandles[handleField];
    if (!rawHandle || !rawHandle.trim()) return;
    const note = "Tennis Friends — court costs";
    const cents = Math.abs(b.netCents);
    const intent = buildPayIntent(method, rawHandle.trim(), cents, note);

    const shareIds = expenses
      .filter((e) => e.payer.id === b.otherId)
      .flatMap((e) => e.shares)
      .filter((s) => s.userId === myId && !s.settledAt)
      .map((s) => s.id);

    const result = await openPayment(intent);

    if (result.kind === "copied") {
      setToast(`Copied: ${result.text}. Open your bank's Zelle to send.`);
      setPendingPay({ shareIds, payeeName: b.otherName, payeeId: b.otherId, amountCents: cents, method });
    } else if (result.kind === "launched_app" || result.kind === "opened_web") {
      setPendingPay({ shareIds, payeeName: b.otherName, payeeId: b.otherId, amountCents: cents, method });
    }
  };

  const [guestSettling, setGuestSettling] = useState<string | null>(null);

  const settleGuest = async (g: GuestBalance) => {
    setGuestSettling(g.guestName);
    try {
      await Promise.all(
        g.openShareIds.map((sid) =>
          fetch(`/api/chats/${chatId}/expenses/guest-shares/${sid}/settle`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ settled: true }),
          }).catch(() => {})
        )
      );
      reload();
    } catch {}
    setGuestSettling(null);
  };

  const unsettleGuestShare = async (shareId: string) => {
    setGuestSettling(shareId);
    try {
      await fetch(`/api/chats/${chatId}/expenses/guest-shares/${shareId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settled: false }),
      });
      reload();
    } catch {}
    setGuestSettling(null);
  };

  const handleConfirmPaid = async () => {
    if (!pendingPay) return;
    setConfirming(true);
    try {
      await Promise.all(
        pendingPay.shareIds.map((sid) =>
          fetch(`/api/chats/${chatId}/expenses/shares/${sid}/settle`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ settled: true }),
          }).catch(() => {})
        )
      );
      setShowReturnPrompt(false);
      setPendingPay(null);
      reload();
    } catch {}
    setConfirming(false);
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

  const owed = balances.filter((b) => b.netCents > 0).reduce((s, b) => s + b.netCents, 0);
  const owing = balances.filter((b) => b.netCents < 0).reduce((s, b) => s - b.netCents, 0);

  return (
    <div className="space-y-4 relative">
      {showReturnPrompt && pendingPay && (
        <div className="rounded-xl border border-court-green bg-court-green/10 p-3">
          <p className="text-sm font-semibold text-court-green">
            Did you finish paying ${dollarsString(pendingPay.amountCents)} to {pendingPay.payeeName} on {PAYMENT_LABELS[pendingPay.method]}?
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={handleConfirmPaid}
              disabled={confirming}
              className="bg-court-green text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-court-green-light disabled:opacity-50"
            >
              {confirming ? "Marking..." : "Yes, mark paid"}
            </button>
            <button
              onClick={() => { setShowReturnPrompt(false); setPendingPay(null); }}
              className="text-xs font-semibold text-gray-600 hover:text-gray-800 px-2 py-1.5"
            >
              Not yet
            </button>
          </div>
        </div>
      )}

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
            const youOwe = b.netCents < 0;
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
                          Tap a method to launch it; come back to confirm.
                        </p>
                      </>
                    ) : (
                      <span className="text-xs text-gray-500 italic">
                        {b.otherName} hasn&apos;t added a payment handle.
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
          {expenses.map((e) => (
            <div key={e.id} className="border border-gray-100 rounded-xl p-3 bg-white">
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
              </div>
              <div className="space-y-1">
                {e.shares.map((s) => {
                  const isMine = s.userId === myId;
                  const settled = !!s.settledAt;
                  return (
                    <div
                      key={s.id}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className={settled ? "text-gray-400 line-through" : "text-gray-700"}>
                        {s.user.name} owes ${dollarsString(s.amountCents)}
                      </span>
                      {isMine ? (
                        <button
                          onClick={() => onSettle(s, !settled)}
                          disabled={settlingId === s.id}
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded-md transition-colors disabled:opacity-50 ${
                            settled
                              ? "bg-gray-100 text-gray-600 hover:bg-gray-200"
                              : "bg-court-green text-white hover:bg-court-green-light"
                          }`}
                        >
                          {settled ? "Undo" : "Mark paid"}
                        </button>
                      ) : settled ? (
                        <span className="text-[11px] font-semibold text-green-600">Paid</span>
                      ) : null}
                    </div>
                  );
                })}
                {e.guestShares.map((g) => {
                  const settled = !!g.settledAt;
                  const iAmPayer = e.payer.id === myId;
                  return (
                    <div
                      key={g.id}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className={settled ? "text-gray-400 line-through" : "text-gray-700"}>
                        {g.guestName} <span className="text-[10px] text-gray-400">(guest)</span> owes ${dollarsString(g.amountCents)}
                      </span>
                      {iAmPayer ? (
                        <button
                          onClick={() => settled ? unsettleGuestShare(g.id) : settleGuest({ guestName: g.guestName, amountCents: g.amountCents, openShareIds: [g.id] })}
                          disabled={guestSettling === g.guestName || guestSettling === g.id}
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded-md transition-colors disabled:opacity-50 ${
                            settled
                              ? "bg-gray-100 text-gray-600 hover:bg-gray-200"
                              : "bg-court-green text-white hover:bg-court-green-light"
                          }`}
                        >
                          {settled ? "Undo" : "Mark paid"}
                        </button>
                      ) : settled ? (
                        <span className="text-[11px] font-semibold text-green-600">Paid</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
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
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venmoHandle: draft.venmoHandle.trim(),
          paypalHandle: draft.paypalHandle.trim(),
          cashappHandle: draft.cashappHandle.trim(),
          zelleHandle: draft.zelleHandle.trim(),
        }),
      });
      if (!res.ok) {
        setError("Could not save. Try again.");
        setSaving(false);
        return;
      }
      setEditing(false);
      onSaved();
    } catch {
      setError("Network error.");
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
