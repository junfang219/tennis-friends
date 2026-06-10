"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/lib/supabase/nextauth-compat";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  fetchGroupBundle,
  getCachedGroupBundle,
  getMyProfile,
  listGroupExpenseColumns,
  listGroupExpenseEvents,
  createGroupExpenseColumn,
  updateGroupExpenseColumn,
  deleteGroupExpenseColumn,
  setCellsSettled,
  type ExpenseColumn,
  type ExpenseCell,
  type ExpenseEventOption,
} from "@/lib/supabase/queries";
import { canCaptain } from "@/lib/groupRoles";
import {
  computeColumnNet,
  computeNetTotals,
  withoutSettled,
  seedEqualShares,
  remainingCents,
  sumAmounts,
  settleUp,
  type ColumnLike,
  type ExpenseShareLike,
} from "@/lib/expenses";
import { buildPayIntent, dollarsString, PAYMENT_LABELS, type PaymentMethod } from "@/lib/payment";
import { openPayment } from "@/lib/openPayment";
import { errorMessage } from "@/lib/errorMessage";
import Avatar from "@/components/Avatar";
import PaymentSetupCard from "@/components/expenses/PaymentSetupCard";

type Member = { id: string; name: string; image: string };
type Handles = {
  venmoHandle: string | null;
  paypalHandle: string | null;
  cashappHandle: string | null;
  zelleHandle: string | null;
};

function centsFromInput(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}
function inputFromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}
function toColLike(c: ExpenseColumn): ColumnLike {
  return {
    payments: c.payments.map((p) => ({ userId: p.user_id, amountCents: p.amount_cents })),
    shares: c.shares.map((s) => ({ userId: s.user_id, amountCents: s.amount_cents })),
  };
}

export default function ExpensesPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const groupId = params.id as string;
  const myId = session?.user?.id || "";

  const cached = getCachedGroupBundle(groupId);
  const [members, setMembers] = useState<Member[]>(
    () =>
      cached?.members.map((m) => ({ id: m.user.id, name: m.user.name, image: m.user.profile_image_url })) ?? []
  );
  const [isCaptain, setIsCaptain] = useState(false);
  const [isMember, setIsMember] = useState<boolean>(!!cached);

  const [columns, setColumns] = useState<ExpenseColumn[]>([]);
  const [events, setEvents] = useState<ExpenseEventOption[]>([]);
  const [myHandles, setMyHandles] = useState<Handles>({
    venmoHandle: null,
    paypalHandle: null,
    cashappHandle: null,
    zelleHandle: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<"grid" | "output">("grid");
  const [settleMode, setSettleMode] = useState(false);
  const [editor, setEditor] = useState<{ column: ExpenseColumn | null } | null>(null);

  const load = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    try {
      const [bundle, cols, eventOpts, me] = await Promise.all([
        fetchGroupBundle(supabase, groupId),
        listGroupExpenseColumns(supabase, groupId),
        listGroupExpenseEvents(supabase, groupId),
        getMyProfile(supabase),
      ]);
      if (!bundle.group) {
        setError("You are not a member of this team.");
        setLoading(false);
        return;
      }
      setMembers(bundle.members.map((m) => ({ id: m.user.id, name: m.user.name, image: m.user.profile_image_url })));
      const mine = bundle.members.find((m) => m.user.id === myId);
      setIsMember(!!mine || bundle.group.owner_id === myId);
      setIsCaptain(canCaptain({ isOwner: bundle.group.owner_id === myId, roles: mine?.roles ?? [] }));
      setColumns(cols);
      setEvents(eventOpts);
      if (me) {
        setMyHandles({
          venmoHandle: me.venmo_handle,
          paypalHandle: me.paypal_handle,
          cashappHandle: me.cashapp_handle,
          zelleHandle: me.zelle_handle,
        });
      }
    } catch (err) {
      setError(errorMessage(err, "Could not load expenses."));
    }
    setLoading(false);
  }, [groupId, myId]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const memberName = useCallback(
    (id: string) => members.find((m) => m.id === id)?.name ?? "Someone",
    [members]
  );

  // Net per member for each column (full — every involved member's cell).
  const colNets = useMemo(() => columns.map((c) => computeColumnNet(toColLike(c))), [columns]);
  // Totals + "Who pays who" exclude SETTLED (member, bill) cells, so a squared-up
  // balance doesn't accumulate into the next events.
  const totals = useMemo(
    () => computeNetTotals(columns.map((c) => withoutSettled(toColLike(c), c.settled_user_ids))),
    [columns]
  );

  // Payment handles for anyone who appears in a column (creditors always do,
  // since a creditor is someone who paid).
  const handlesByUser = useMemo(() => {
    const m = new Map<string, Handles>();
    for (const c of columns) {
      for (const row of [...c.payments, ...c.shares]) {
        if (row.user && !m.has(row.user.id)) {
          m.set(row.user.id, {
            venmoHandle: row.user.venmo_handle,
            paypalHandle: row.user.paypal_handle,
            cashappHandle: row.user.cashapp_handle,
            zelleHandle: row.user.zelle_handle,
          });
        }
      }
    }
    return m;
  }, [columns]);

  // Editing/deleting a column stays with its creator or a captain.
  const canEditColumn = useCallback(
    (c: ExpenseColumn) => isCaptain || c.created_by_id === myId,
    [isCaptain, myId]
  );

  // Settling is open to anyone INVOLVED in the column (a participant or a
  // payer), plus the creator/captain.
  const canSettleColumn = useCallback(
    (c: ExpenseColumn) =>
      isCaptain ||
      c.created_by_id === myId ||
      c.shares.some((s) => s.user_id === myId) ||
      c.payments.some((p) => p.user_id === myId),
    [isCaptain, myId]
  );

  const onDelete = async (c: ExpenseColumn) => {
    if (!confirm(`Delete "${c.event_label || "this column"}" ($${dollarsString(c.amount_cents)})? This can't be undone.`)) return;
    try {
      const supabase = createSupabaseBrowserClient();
      await deleteGroupExpenseColumn(supabase, c.id);
      await load();
    } catch (err) {
      alert(errorMessage(err, "Could not delete."));
    }
  };

  // Settle / un-settle a set of (member, bill) cells. Optimistically updates the
  // local settled sets, then persists via the RPC (which re-checks permission
  // per cell). On failure we reload to fall back to server truth.
  const settleCells = useCallback(
    async (cells: ExpenseCell[], settled: boolean) => {
      if (cells.length === 0) return;
      setColumns((prev) =>
        prev.map((c) => {
          const ids = cells.filter((x) => x.expenseId === c.id).map((x) => x.userId);
          if (ids.length === 0) return c;
          const set = new Set(c.settled_user_ids);
          for (const id of ids) {
            if (settled) set.add(id);
            else set.delete(id);
          }
          return { ...c, settled_user_ids: [...set] };
        })
      );
      try {
        const supabase = createSupabaseBrowserClient();
        await setCellsSettled(supabase, cells, settled);
      } catch (err) {
        alert(errorMessage(err, "Could not update settled status."));
        await load();
      }
    },
    [load]
  );

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="skeleton w-40 h-7 mb-5" />
        <div className="skeleton w-full h-64" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-10 text-center">
        <p className="text-gray-500">{error}</p>
        <button onClick={() => router.back()} className="btn-primary mt-4">Go Back</button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-5">
        <Link href={`/groups/${groupId}`} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15,18 9,12 15,6" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-xl font-bold text-court-green truncate">Expenses</h1>
          <p className="text-xs text-gray-500">Split match &amp; practice costs, see who pays who</p>
        </div>
      </div>

      <div className="flex items-center gap-1 mb-4">
        {(["grid", "output"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
              view === v ? "bg-court-green text-white" : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            {v === "grid" ? "Grid" : "Who pays who"}
          </button>
        ))}
      </div>

      {isMember && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button onClick={() => setEditor({ column: null })} className="btn-primary btn-sm">
            + Add a column
          </button>
          {view === "grid" && columns.length > 0 && (
            <button
              onClick={() => setSettleMode((s) => !s)}
              className={settleMode ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
            >
              {settleMode ? "Done settling" : "Settle…"}
            </button>
          )}
        </div>
      )}

      {view === "grid" ? (
        <ExpenseGrid
          members={members}
          columns={columns}
          colNets={colNets}
          settleMode={settleMode}
          canSettleColumn={canSettleColumn}
          canEditColumn={canEditColumn}
          onEdit={(c) => setEditor({ column: c })}
          onDelete={onDelete}
          settleCells={settleCells}
        />
      ) : (
        <OutputView
          members={members}
          columns={columns}
          colNets={colNets}
          totals={totals}
          myId={myId}
          myHandles={myHandles}
          handlesByUser={handlesByUser}
          memberName={memberName}
          reload={load}
        />
      )}

      {editor && isMember && (
        <ColumnEditor
          members={members}
          events={events}
          column={editor.column}
          groupId={groupId}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function NetAmount({ cents }: { cents: number }) {
  if (cents === 0) return <span className="text-gray-400">—</span>;
  if (cents > 0) return <span className="text-orange-700 font-bold">pays ${dollarsString(cents)}</span>;
  return <span className="text-green-700 font-bold">gets ${dollarsString(-cents)}</span>;
}

// ===========================================================================
// Grid: rows = members, columns = events. Shows paid / owed / net per cell.
// In Settle mode, each involved cell + whole bill (column) + whole member (row)
// becomes a checkbox to mark that (member, bill) settled.
// ===========================================================================

function ExpenseGrid({
  members,
  columns,
  colNets,
  settleMode,
  canSettleColumn,
  canEditColumn,
  onEdit,
  onDelete,
  settleCells,
}: {
  members: Member[];
  columns: ExpenseColumn[];
  colNets: Map<string, number>[];
  settleMode: boolean;
  canSettleColumn: (c: ExpenseColumn) => boolean;
  canEditColumn: (c: ExpenseColumn) => boolean;
  onEdit: (c: ExpenseColumn) => void;
  onDelete: (c: ExpenseColumn) => void;
  settleCells: (cells: ExpenseCell[], settled: boolean) => void;
}) {
  if (members.length === 0) {
    return <p className="text-center text-sm text-gray-500 py-10">No team members yet.</p>;
  }
  if (columns.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-2xl border border-court-green-pale/20">
        <p className="text-sm text-gray-500">No expense columns yet.</p>
        <p className="text-xs text-gray-400 mt-1">Add a column for a match or practice to start splitting costs.</p>
      </div>
    );
  }

  const shareOf = (c: ExpenseColumn, id: string) => c.shares.find((s) => s.user_id === id)?.amount_cents ?? null;
  const paidOf = (c: ExpenseColumn, id: string) => c.payments.find((p) => p.user_id === id)?.amount_cents ?? 0;
  const involvedIn = (c: ExpenseColumn, id: string) => shareOf(c, id) !== null || paidOf(c, id) > 0;
  const isSettled = (c: ExpenseColumn, id: string) => c.settled_user_ids.includes(id);
  const involvedIds = (c: ExpenseColumn) => members.filter((m) => involvedIn(c, m.id)).map((m) => m.id);

  // Whole bill (column header): settle/unsettle every involved member's cell.
  const settleBill = (c: ExpenseColumn) => {
    const ids = involvedIds(c);
    if (ids.length === 0) return;
    const allSettled = ids.every((id) => isSettled(c, id));
    settleCells(ids.map((id) => ({ expenseId: c.id, userId: id })), !allSettled);
  };
  // Whole member (row): settle their cells across the bills the user may settle.
  const memberSettleCols = (mId: string) => columns.filter((c) => canSettleColumn(c) && involvedIn(c, mId));
  const settleMember = (mId: string) => {
    const cols = memberSettleCols(mId);
    if (cols.length === 0) return;
    const allSettled = cols.every((c) => isSettled(c, mId));
    settleCells(cols.map((c) => ({ expenseId: c.id, userId: mId })), !allSettled);
  };

  return (
    <div className="overflow-x-auto rounded-2xl border border-court-green-pale/20 bg-white">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-gray-50 text-left text-xs font-semibold text-gray-600 px-3 py-2 border-b border-gray-100 min-w-[8rem]">
              Member
            </th>
            {columns.map((c) => {
              const ids = involvedIds(c);
              const fullySettled = ids.length > 0 && ids.every((id) => isSettled(c, id));
              const canSettle = canSettleColumn(c);
              const canEdit = canEditColumn(c);
              return (
                <th key={c.id} className="text-left align-top px-3 py-2 border-b border-l border-gray-100 min-w-[10rem]">
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {settleMode && canSettle && ids.length > 0 && (
                          <input
                            type="checkbox"
                            checked={fullySettled}
                            onChange={() => settleBill(c)}
                            title="Settle / re-open whole bill"
                            className="w-3.5 h-3.5 accent-court-green shrink-0"
                          />
                        )}
                        <p className="text-xs font-semibold text-gray-800 truncate" title={c.event_label ?? ""}>
                          {c.event_label || "Column"}
                        </p>
                      </div>
                      <p className="text-[11px] text-gray-500">total ${dollarsString(c.amount_cents)}</p>
                    </div>
                    {!settleMode && canEdit && (
                      <div className="flex flex-col gap-1 shrink-0">
                        <button onClick={() => onEdit(c)} title="Edit" aria-label="Edit column" className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button onClick={() => onDelete(c)} title="Delete" aria-label="Delete column" className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const rowCols = memberSettleCols(m.id);
            const rowAllSettled = rowCols.length > 0 && rowCols.every((c) => isSettled(c, m.id));
            return (
              <tr key={m.id} className="odd:bg-white even:bg-gray-50/40">
                <td className="sticky left-0 z-10 bg-inherit px-3 py-2 border-b border-gray-100 min-w-[8rem]">
                  <div className="flex items-center gap-2">
                    {settleMode && rowCols.length > 0 && (
                      <input
                        type="checkbox"
                        checked={rowAllSettled}
                        onChange={() => settleMember(m.id)}
                        title="Settle / re-open this member across all bills"
                        className="w-3.5 h-3.5 accent-court-green shrink-0"
                      />
                    )}
                    <Avatar name={m.name} image={m.image} size="sm" />
                    <span className="text-xs font-medium text-gray-800 truncate">{m.name}</span>
                  </div>
                </td>
                {columns.map((c, i) => {
                  const share = shareOf(c, m.id);
                  const paid = paidOf(c, m.id);
                  const net = colNets[i].get(m.id) ?? 0;
                  const involved = share !== null || paid > 0;
                  const settled = involved && isSettled(c, m.id);
                  return (
                    <td key={c.id} className={`px-3 py-2 border-b border-l border-gray-100 align-top whitespace-nowrap ${settled ? "bg-gray-50" : ""}`}>
                      {!involved ? (
                        <span className="text-gray-300">—</span>
                      ) : (
                        <div className="flex items-start gap-1.5">
                          {settleMode && canSettleColumn(c) && (
                            <input
                              type="checkbox"
                              checked={settled}
                              onChange={() => settleCells([{ expenseId: c.id, userId: m.id }], !settled)}
                              title={settled ? "Re-open this cell" : "Mark settled"}
                              className="w-3.5 h-3.5 mt-0.5 accent-court-green shrink-0"
                            />
                          )}
                          <div className={`space-y-0.5 ${settled ? "opacity-50" : ""}`}>
                            <div className="flex items-center gap-1">
                              <NetAmount cents={net} />
                              {settled && (
                                <span className="text-[9px] font-bold uppercase tracking-wide text-green-700 bg-green-50 border border-green-200 px-1 rounded">
                                  settled
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-gray-400">
                              {paid > 0 && <>paid ${dollarsString(paid)}</>}
                              {paid > 0 && share !== null && " · "}
                              {share !== null && <>owes ${dollarsString(share)}</>}
                            </p>
                          </div>
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ===========================================================================
// Output: "Who pays who" — member × event net matrix + Total + payouts
// ===========================================================================

function OutputView({
  members,
  columns,
  colNets,
  totals,
  myId,
  myHandles,
  handlesByUser,
  memberName,
  reload,
}: {
  members: Member[];
  columns: ExpenseColumn[];
  colNets: Map<string, number>[]; // full per-column nets (settled cells flagged separately)
  totals: Map<string, number>; // excludes settled cells
  myId: string;
  myHandles: Handles;
  handlesByUser: Map<string, Handles>;
  memberName: (id: string) => string;
  reload: () => void;
}) {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const transfers = useMemo(() => settleUp(totals), [totals]);
  const iPay = transfers.filter((t) => t.fromId === myId);
  const owedToMe = transfers.filter((t) => t.toId === myId);
  const myTotal = totals.get(myId) ?? 0;

  const handlePay = async (toId: string, cents: number, method: PaymentMethod) => {
    const handle = handlesByUser.get(toId)?.[`${method}Handle` as const];
    if (!handle || !handle.trim()) return;
    const intent = buildPayIntent(method, handle.trim(), cents, "Tennis Friends — team costs");
    const res = await openPayment(intent);
    if (res.kind === "copied") setToast(`Copied: ${res.text}. Open your bank's Zelle to send.`);
  };

  const allSettled = members.every((m) => (totals.get(m.id) ?? 0) === 0);

  if (columns.length === 0) {
    return <p className="text-center text-sm text-gray-500 py-10">No expense columns yet.</p>;
  }

  return (
    <div className="space-y-5 relative">
      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-[10001] bg-gray-900 text-white text-xs font-medium px-3 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      <p className="text-[11px] text-gray-400">
        Settled cells (greyed in the Grid) drop out of these totals.{allSettled ? " All settled up. 🎾" : ""}
      </p>

      {/* Net matrix: rows = members, columns = events, + Total */}
      <div className="overflow-x-auto rounded-2xl border border-court-green-pale/20 bg-white">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 text-left text-xs font-semibold text-gray-600 px-3 py-2 border-b border-gray-100 min-w-[8rem]">
                Member
              </th>
              {columns.map((c) => (
                <th key={c.id} className="text-left text-xs font-semibold text-gray-600 px-3 py-2 border-b border-l border-gray-100 min-w-[9rem]">
                  <span className="block truncate" title={c.event_label ?? ""}>{c.event_label || "Column"}</span>
                </th>
              ))}
              <th className="text-left text-xs font-bold text-gray-700 px-3 py-2 border-b border-l-2 border-court-green-pale/40 bg-court-green-pale/10 min-w-[9rem]">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="odd:bg-white even:bg-gray-50/40">
                <td className="sticky left-0 z-10 bg-inherit px-3 py-2 border-b border-gray-100 min-w-[8rem]">
                  <div className="flex items-center gap-2">
                    <Avatar name={m.name} image={m.image} size="sm" />
                    <span className="text-xs font-medium text-gray-800 truncate">{m.name}</span>
                  </div>
                </td>
                {columns.map((c, i) => {
                  const settled = c.settled_user_ids.includes(m.id);
                  return (
                    <td key={c.id} className={`px-3 py-2 border-b border-l border-gray-100 text-xs whitespace-nowrap ${settled ? "bg-gray-50" : ""}`}>
                      {settled ? (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-green-700">settled</span>
                      ) : (
                        <NetAmount cents={colNets[i].get(m.id) ?? 0} />
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-2 border-b border-l-2 border-court-green-pale/40 bg-court-green-pale/10 text-xs whitespace-nowrap">
                  <NetAmount cents={totals.get(m.id) ?? 0} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* My payouts */}
      <div className="space-y-3">
        <div className="bg-white rounded-2xl border border-court-green-pale/20 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Your total</p>
          <p className="text-lg mt-0.5"><NetAmount cents={myTotal} /></p>
        </div>

        {myTotal < 0 && <PaymentSetupCard handles={myHandles} onSaved={reload} />}

        {iPay.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">You pay</p>
            {iPay.map((t) => {
              const methods = (["venmo", "paypal", "cashapp", "zelle"] as PaymentMethod[]).filter(
                (mtd) => (handlesByUser.get(t.toId)?.[`${mtd}Handle` as const] || "").trim().length > 0
              );
              return (
                <div key={t.toId} className="rounded-xl p-3 border bg-orange-50/50 border-orange-200">
                  <span className="text-sm text-gray-800">
                    Pay <span className="font-semibold">{memberName(t.toId)}</span>{" "}
                    <span className="font-bold">${dollarsString(t.amountCents)}</span>
                  </span>
                  {methods.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {methods.map((mtd) => (
                        <button
                          key={mtd}
                          onClick={() => handlePay(t.toId, t.amountCents, mtd)}
                          className="bg-court-green text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-court-green-light"
                        >
                          {PAYMENT_LABELS[mtd]}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-gray-500 italic mt-1.5">
                      {memberName(t.toId)} hasn&apos;t added a payment handle — pay in person.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {owedToMe.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Owed to you</p>
            {owedToMe.map((t) => (
              <div key={t.fromId} className="rounded-xl p-3 border bg-green-50/50 border-green-200">
                <span className="text-sm text-gray-800">
                  <span className="font-semibold">{memberName(t.fromId)}</span> pays you{" "}
                  <span className="font-bold">${dollarsString(t.amountCents)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Editor: one event column — participants (split) + multiple payers (payments)
// ===========================================================================

function ColumnEditor({
  members,
  events,
  column,
  groupId,
  onClose,
  onSaved,
}: {
  members: Member[];
  events: ExpenseEventOption[];
  column: ExpenseColumn | null;
  groupId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!column;
  const eventKey = (e: ExpenseEventOption) => `${e.kind}:${e.id}`;

  const [sourceSel, setSourceSel] = useState<string>(() => {
    if (column) {
      if (column.source_kind === "match" && column.match_id) return `match:${column.match_id}`;
      if (column.source_kind === "practice" && column.practice_id) return `practice:${column.practice_id}`;
      return "custom";
    }
    return events[0] ? eventKey(events[0]) : "custom";
  });
  const selectedEvent = events.find((e) => eventKey(e) === sourceSel) ?? null;
  const sourceKind: "match" | "practice" | "custom" =
    sourceSel === "custom" ? "custom" : selectedEvent ? selectedEvent.kind : "custom";

  const [label, setLabel] = useState<string>(column?.event_label ?? "");
  const [participants, setParticipants] = useState<Set<string>>(() => {
    if (column) return new Set(column.shares.map((s) => s.user_id));
    return new Set(events[0]?.participantIds ?? []);
  });
  // Paid amounts keyed by member (dollar strings); 0/empty = not a payer.
  const [paid, setPaid] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    if (column) for (const p of column.payments) m[p.user_id] = inputFromCents(p.amount_cents);
    return m;
  });
  const [splitMode, setSplitMode] = useState<"equal" | "custom">("equal");
  const [customOwed, setCustomOwed] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    if (column) for (const s of column.shares) m[s.user_id] = inputFromCents(s.amount_cents);
    return m;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const onSourceChange = (val: string) => {
    setSourceSel(val);
    if (val === "custom") {
      setParticipants(new Set());
      return;
    }
    const ev = events.find((e) => eventKey(e) === val);
    if (ev) {
      setParticipants(new Set(ev.participantIds));
      setLabel("");
    }
  };

  const memberOrder = members.map((m) => m.id);
  const participantIds = memberOrder.filter((id) => participants.has(id));
  const payments = members
    .map((m) => ({ userId: m.id, amountCents: centsFromInput(paid[m.id] ?? "") }))
    .filter((p) => p.amountCents > 0);
  const totalCents = sumAmounts(payments);

  const equalById = new Map<string, number>(
    seedEqualShares(totalCents, participantIds).map((s) => [s.userId, s.amountCents])
  );
  const customShares: ExpenseShareLike[] = participantIds.map((id) => ({
    userId: id,
    amountCents: centsFromInput(customOwed[id] ?? "0"),
  }));
  const remaining = remainingCents(totalCents, customShares);

  const toggle = (id: string) =>
    setParticipants((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const finalLabel = () => (sourceKind === "custom" ? label.trim() : selectedEvent?.label ?? column?.event_label ?? "");

  const save = async () => {
    setErr("");
    if (totalCents <= 0) return setErr("Enter at least one payment.");
    if (participantIds.length === 0) return setErr("Mark at least one participant.");
    if (sourceKind === "custom" && !finalLabel()) return setErr("Name the custom event.");
    if (splitMode === "custom" && remaining !== 0) {
      return setErr(`Owed amounts must add up to $${dollarsString(totalCents)} (${remaining > 0 ? `$${dollarsString(remaining)} left` : `$${dollarsString(-remaining)} over`}).`);
    }
    const shares = splitMode === "equal" ? seedEqualShares(totalCents, participantIds) : customShares;

    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      if (isEdit && column) {
        await updateGroupExpenseColumn(supabase, column.id, {
          amountCents: totalCents,
          eventLabel: sourceKind === "custom" ? finalLabel() : undefined,
          shares,
          payments,
        });
      } else {
        await createGroupExpenseColumn(supabase, {
          groupId,
          sourceKind,
          matchId: sourceKind === "match" ? selectedEvent?.id ?? null : null,
          practiceId: sourceKind === "practice" ? selectedEvent?.id ?? null : null,
          eventLabel: finalLabel(),
          amountCents: totalCents,
          shares,
          payments,
        });
      }
      onSaved();
    } catch (e) {
      setErr(errorMessage(e, "Could not save the column."));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[10000] bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[92vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-display text-lg font-bold text-gray-900">{isEdit ? "Edit column" : "Add a column"}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Event</label>
            {isEdit ? (
              <p className="text-sm text-gray-700">{column?.event_label || (sourceKind === "custom" ? "Custom event" : "—")}</p>
            ) : (
              <select value={sourceSel} onChange={(e) => onSourceChange(e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white">
                {events.length > 0 && (
                  <optgroup label="Matches & practices">
                    {events.map((e) => (
                      <option key={eventKey(e)} value={eventKey(e)}>
                        {e.kind === "match" ? "🎾 " : "🏃 "}{e.label}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value="custom">＋ Custom event…</option>
              </select>
            )}
          </div>

          {sourceKind === "custom" && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Custom event name</label>
              <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Team dinner" maxLength={80} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm" />
            </div>
          )}

          {/* Split mode toggle */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-700">
              Total ${dollarsString(totalCents)} · split among {participantIds.length}
            </span>
            <div className="flex items-center gap-1">
              {(["equal", "custom"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setSplitMode(mode)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${splitMode === mode ? "bg-court-green text-white" : "text-gray-500 bg-gray-100"}`}
                >
                  {mode === "equal" ? "Equal" : "Custom"}
                </button>
              ))}
            </div>
          </div>

          {/* Per-member rows: participant?, paid, owes */}
          <div className="border border-gray-100 rounded-xl overflow-hidden">
            <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-2 px-3 py-2 bg-gray-50 text-[10px] font-bold uppercase tracking-wide text-gray-500">
              <span>Plays?</span>
              <span>Paid</span>
              <span>Owes</span>
            </div>
            <div className="divide-y divide-gray-100">
              {members.map((m) => {
                const on = participants.has(m.id);
                return (
                  <div key={m.id} className="grid grid-cols-[1.4fr_1fr_1fr] gap-2 px-3 py-2 items-center">
                    <label className="flex items-center gap-2 min-w-0">
                      <input type="checkbox" checked={on} onChange={() => toggle(m.id)} className="w-4 h-4 accent-court-green shrink-0" />
                      <Avatar name={m.name} image={m.image} size="sm" />
                      <span className="text-sm text-gray-800 truncate">{m.name}</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                      <input
                        type="number" inputMode="decimal" step="0.01" min="0"
                        value={paid[m.id] ?? ""}
                        onChange={(e) => setPaid((c) => ({ ...c, [m.id]: e.target.value }))}
                        placeholder="0.00"
                        className="w-full pl-5 pr-2 py-1 border border-gray-200 rounded-lg text-xs"
                      />
                    </div>
                    <div>
                      {on ? (
                        splitMode === "equal" ? (
                          <span className="text-xs text-gray-600">${dollarsString(equalById.get(m.id) ?? 0)}</span>
                        ) : (
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                            <input
                              type="number" inputMode="decimal" step="0.01" min="0"
                              value={customOwed[m.id] ?? ""}
                              onChange={(e) => setCustomOwed((c) => ({ ...c, [m.id]: e.target.value }))}
                              placeholder="0.00"
                              className="w-full pl-5 pr-2 py-1 border border-gray-200 rounded-lg text-xs"
                            />
                          </div>
                        )
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {splitMode === "custom" && participantIds.length > 0 && (
            <p className={`text-[11px] ${remaining === 0 ? "text-gray-500" : "text-red-600"}`}>
              {remaining === 0
                ? `Owed adds up to $${dollarsString(totalCents)}. ✓`
                : remaining > 0
                  ? `$${dollarsString(remaining)} left to allocate.`
                  : `$${dollarsString(-remaining)} over the total.`}
            </p>
          )}

          {err && <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{err}</div>}
        </div>

        <div className="px-5 py-3 border-t border-gray-100">
          <button onClick={save} disabled={busy} className="btn-primary w-full py-2.5">
            {busy ? "Saving…" : isEdit ? "Save changes" : "Add column"}
          </button>
        </div>
      </div>
    </div>
  );
}
