"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";

// One court-availability subscription. Fields mirror public.court_alerts
// (snake_case); UI converts to its own shape as needed.
export interface CourtAlert {
  id: string;
  user_id: string;
  court_id: string; // catalog facility id "tf-N"
  mode: "once" | "repeat";
  target_date: string | null; // 'YYYY-MM-DD' when mode='once'
  weekdays: number[] | null; // JS getDay() values (0=Sun) when mode='repeat'
  start_time: string | null; // 'HH:mm' or null (any time)
  end_time: string | null;
  notify_push: boolean;
  notify_email: boolean;
  active: boolean;
  created_at: string;
}

const ALERT_COLUMNS =
  "id, user_id, court_id, mode, target_date, weekdays, start_time, end_time, notify_push, notify_email, active, created_at";

/** Soft cap on active alerts per user — keeps the cron's poll set bounded. */
export const MAX_ACTIVE_ALERTS = 20;

export async function listMyCourtAlerts(
  supabase: SupabaseClient<Database>
): Promise<CourtAlert[]> {
  const { data, error } = await supabase
    .from("court_alerts")
    .select(ALERT_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CourtAlert[];
}

export type CreateCourtAlertInput = {
  courtId: string;
  mode: "once" | "repeat";
  targetDate?: string | null;
  weekdays?: number[] | null;
  startTime?: string | null;
  endTime?: string | null;
  notifyPush: boolean;
  notifyEmail: boolean;
};

export async function createCourtAlert(
  supabase: SupabaseClient<Database>,
  input: CreateCourtAlertInput
): Promise<CourtAlert> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");

  if (!input.notifyPush && !input.notifyEmail) {
    throw new Error("Pick at least one way to be notified.");
  }

  const { count } = await supabase
    .from("court_alerts")
    .select("id", { count: "exact", head: true })
    .eq("active", true);
  if ((count ?? 0) >= MAX_ACTIVE_ALERTS) {
    throw new Error(
      `You can have up to ${MAX_ACTIVE_ALERTS} active alerts. Remove one first.`
    );
  }

  const { data, error } = await supabase
    .from("court_alerts")
    .insert({
      user_id: auth.user.id,
      court_id: input.courtId,
      mode: input.mode,
      target_date: input.mode === "once" ? input.targetDate ?? null : null,
      weekdays: input.mode === "repeat" ? input.weekdays ?? null : null,
      start_time: input.startTime ?? null,
      end_time: input.endTime ?? null,
      notify_push: input.notifyPush,
      notify_email: input.notifyEmail,
    })
    .select(ALERT_COLUMNS)
    .single();
  if (error) throw error;
  return data as CourtAlert;
}

export async function setCourtAlertActive(
  supabase: SupabaseClient<Database>,
  id: string,
  active: boolean
): Promise<void> {
  const { error } = await supabase
    .from("court_alerts")
    .update({ active })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteCourtAlert(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<void> {
  const { error } = await supabase.from("court_alerts").delete().eq("id", id);
  if (error) throw error;
}
