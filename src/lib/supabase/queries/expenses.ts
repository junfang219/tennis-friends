"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";
import { PAYMENT_PROFILE_COLUMNS, type PaymentProfile } from "./profiles";
import type { ExpenseShareLike, PaymentLike } from "../../expenses";
import { RSVP, normalizeMatchStatus, normalizePracticeStatus } from "../../rsvpStatus";

// ---------------------------------------------------------------------------
// Event options for the "add a column" dropdown
// ---------------------------------------------------------------------------

export type ExpenseEventKind = "match" | "practice";

export interface ExpenseEventOption {
  kind: ExpenseEventKind;
  id: string; // team_matches.id or team_practices.id
  label: string;
  date: string; // YYYY-MM-DD, for sorting newest-first
  /** Members whose RSVP normalizes to "playing" — the default participant set. */
  participantIds: string[];
}

type RawAvail = { user_id: string | null; status: string | null };

function playingIds(avails: RawAvail[] | null | undefined, kind: ExpenseEventKind): string[] {
  const normalize = kind === "match" ? normalizeMatchStatus : normalizePracticeStatus;
  return (avails ?? [])
    .filter((a) => a.user_id && normalize(a.status ?? "") === RSVP.PLAYING)
    .map((a) => a.user_id as string);
}

export async function listGroupExpenseEvents(
  supabase: SupabaseClient<Database>,
  groupId: string
): Promise<ExpenseEventOption[]> {
  const [matchRes, seriesRes] = await Promise.all([
    supabase
      .from("team_matches")
      .select(`id, match_date, opponent, availabilities ( user_id, status )`)
      .eq("group_id", groupId),
    supabase
      .from("practice_series")
      .select(`name, team_practices ( id, practice_date, availabilities ( user_id, status ) )`)
      .eq("group_id", groupId),
  ]);
  if (matchRes.error) throw matchRes.error;
  if (seriesRes.error) throw seriesRes.error;

  type RawMatch = { id: string; match_date: string; opponent: string | null; availabilities: RawAvail[] | null };
  type RawSeries = {
    name: string;
    team_practices: { id: string; practice_date: string; availabilities: RawAvail[] | null }[] | null;
  };

  const matches: ExpenseEventOption[] = ((matchRes.data ?? []) as unknown as RawMatch[]).map((m) => ({
    kind: "match" as const,
    id: m.id,
    label: `${m.match_date}${m.opponent ? ` vs ${m.opponent}` : ""}`,
    date: m.match_date,
    participantIds: playingIds(m.availabilities, "match"),
  }));

  const practices: ExpenseEventOption[] = ((seriesRes.data ?? []) as unknown as RawSeries[]).flatMap((s) =>
    (s.team_practices ?? []).map((p) => ({
      kind: "practice" as const,
      id: p.id,
      label: `${s.name} ${p.practice_date}`,
      date: p.practice_date,
      participantIds: playingIds(p.availabilities, "practice"),
    }))
  );

  return [...matches, ...practices].sort((a, b) => b.date.localeCompare(a.date));
}

// ---------------------------------------------------------------------------
// Expense columns (one per event) = total split among participants (shares) +
// one or more payers (payments)
// ---------------------------------------------------------------------------

export interface ColumnShare {
  id: string;
  user_id: string;
  amount_cents: number;
  user: PaymentProfile | null;
}

export interface ColumnPayment {
  id: string;
  user_id: string;
  amount_cents: number;
  user: PaymentProfile | null;
}

export interface ExpenseColumn {
  id: string;
  group_id: string;
  created_by_id: string | null;
  source_kind: "match" | "practice" | "custom";
  match_id: string | null;
  practice_id: string | null;
  event_label: string | null;
  amount_cents: number; // total (kept = sum of payments)
  created_at: string;
  shares: ColumnShare[]; // participants' owed amounts
  payments: ColumnPayment[]; // who paid how much
  /** user_ids whose (member, bill) cell is settled — excluded from net totals. */
  settled_user_ids: string[];
}

const COLUMN_SELECT = `id, group_id, created_by_id, source_kind, match_id, practice_id, event_label, amount_cents, created_at,
   shares:expense_shares ( id, user_id, amount_cents, user:profiles ( ${PAYMENT_PROFILE_COLUMNS} ) ),
   payments:expense_payments ( id, user_id, amount_cents, user:profiles ( ${PAYMENT_PROFILE_COLUMNS} ) ),
   settlements:expense_settlements ( user_id )`;

/** All team expense columns, oldest-first so they read left-to-right by date added. */
export async function listGroupExpenseColumns(
  supabase: SupabaseClient<Database>,
  groupId: string
): Promise<ExpenseColumn[]> {
  const { data, error } = await supabase
    .from("expenses")
    .select(COLUMN_SELECT)
    .eq("group_id", groupId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  type RawSettlement = { user_id: string };
  return ((data ?? []) as unknown as (ExpenseColumn & { settlements: RawSettlement[] | null })[]).map((c) => ({
    ...c,
    shares: (c.shares ?? []).filter((s) => s.user_id !== null),
    payments: (c.payments ?? []).filter((p) => p.user_id !== null),
    settled_user_ids: (c.settlements ?? []).map((s) => s.user_id),
  }));
}

export interface SaveColumnInput {
  amountCents: number; // total (sum of payments)
  eventLabel?: string | null; // only for custom events
  shares: ExpenseShareLike[]; // participants' owed amounts (sum = amountCents)
  payments: PaymentLike[]; // payers' amounts (sum = amountCents)
}

export interface CreateColumnInput extends SaveColumnInput {
  groupId: string;
  sourceKind: "match" | "practice" | "custom";
  matchId?: string | null;
  practiceId?: string | null;
}

/** Create an event column and its initial payments + participant split. */
export async function createGroupExpenseColumn(
  supabase: SupabaseClient<Database>,
  input: CreateColumnInput
): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");

  const { data: exp, error } = await supabase
    .from("expenses")
    .insert({
      group_id: input.groupId,
      created_by_id: auth.user.id,
      payer_id: null, // team columns use expense_payments, not a single payer
      amount_cents: input.amountCents,
      source_kind: input.sourceKind,
      match_id: input.sourceKind === "match" ? input.matchId ?? null : null,
      practice_id: input.sourceKind === "practice" ? input.practiceId ?? null : null,
      event_label: input.eventLabel?.trim() ?? null,
    })
    .select("id")
    .single();
  if (error || !exp) throw error ?? new Error("Could not create the column");

  await replaceShares(supabase, exp.id, input.shares);
  await replacePayments(supabase, exp.id, input.payments);
  return exp.id;
}

/** Update an event column's total, label, payments, and participant split. */
export async function updateGroupExpenseColumn(
  supabase: SupabaseClient<Database>,
  expenseId: string,
  input: SaveColumnInput
): Promise<void> {
  const { error } = await supabase
    .from("expenses")
    .update({
      amount_cents: input.amountCents,
      ...(input.eventLabel !== undefined ? { event_label: input.eventLabel?.trim() || null } : {}),
    })
    .eq("id", expenseId);
  if (error) throw error;
  await replaceShares(supabase, expenseId, input.shares);
  await replacePayments(supabase, expenseId, input.payments);
}

export async function deleteGroupExpenseColumn(
  supabase: SupabaseClient<Database>,
  expenseId: string
): Promise<void> {
  // expense_shares + expense_payments cascade-delete via FK.
  const { error } = await supabase.from("expenses").delete().eq("id", expenseId);
  if (error) throw error;
}

export interface ExpenseCell {
  expenseId: string;
  userId: string;
}

/**
 * Mark a set of (member, bill) cells settled (or re-open with settled=false).
 * Settled cells drop out of the running Total + "Who pays who" payouts so a
 * squared-up balance doesn't carry into future events.
 *
 * Goes through the set_expense_cells_settled RPC (SECURITY DEFINER) so any
 * member INVOLVED in a bill (participant or payer) — as well as the creator or
 * a captain — can settle its cells, while only ever touching expense_settlements.
 * The RPC re-checks permission per cell, so ones the caller isn't allowed to
 * settle are silently skipped.
 */
export async function setCellsSettled(
  supabase: SupabaseClient<Database>,
  cells: ExpenseCell[],
  settled: boolean
): Promise<void> {
  if (cells.length === 0) return;
  const { error } = await supabase.rpc("set_expense_cells_settled", {
    p_pairs: cells.map((c) => ({ e: c.expenseId, u: c.userId })),
    p_settled: settled,
  });
  if (error) throw error;
}

async function replaceShares(
  supabase: SupabaseClient<Database>,
  expenseId: string,
  shares: ExpenseShareLike[]
): Promise<void> {
  const { error: delErr } = await supabase.from("expense_shares").delete().eq("expense_id", expenseId);
  if (delErr) throw delErr;
  if (shares.length === 0) return;
  const { error: insErr } = await supabase.from("expense_shares").insert(
    shares.map((s) => ({ expense_id: expenseId, user_id: s.userId, amount_cents: s.amountCents }))
  );
  if (insErr) throw insErr;
}

async function replacePayments(
  supabase: SupabaseClient<Database>,
  expenseId: string,
  payments: PaymentLike[]
): Promise<void> {
  const { error: delErr } = await supabase.from("expense_payments").delete().eq("expense_id", expenseId);
  if (delErr) throw delErr;
  const nonZero = payments.filter((p) => p.amountCents > 0);
  if (nonZero.length === 0) return;
  const { error: insErr } = await supabase.from("expense_payments").insert(
    nonZero.map((p) => ({ expense_id: expenseId, user_id: p.userId, amount_cents: p.amountCents }))
  );
  if (insErr) throw insErr;
}
