import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Close availability polls whose latest candidate date is already in the past
 * (with one day of grace). Run daily via the pg_cron job
 * `close-stale-polls-daily` (declared in the canonical schema), which calls
 * this route with `Authorization: Bearer <CRON_SECRET>`.
 *
 * We compare against yesterday rather than today because a poll's last
 * candidate date is still actionable until the end of that day (the captain
 * may convert it before evening). A 1-day buffer also tolerates timezone
 * drift between the team's wall-clock zone and the cron host's UTC.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();

  // Pull open polls and decide in JS — Postgres date-arithmetic on date[] would
  // need a custom SQL function, and the volume is tiny (one row per active poll).
  const { data: rows, error } = await admin
    .from("availability_polls")
    .select("id, candidate_dates")
    .eq("status", "open");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const cutoffIso = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;

  const toClose: string[] = [];
  for (const r of rows ?? []) {
    const dates = (r.candidate_dates ?? []) as string[];
    if (dates.length === 0) continue;
    const latest = dates.reduce((a, b) => (a > b ? a : b));
    if (latest < cutoffIso) toClose.push(r.id);
  }

  if (toClose.length === 0) {
    return NextResponse.json({ closed: 0 });
  }

  const { error: upErr } = await admin
    .from("availability_polls")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .in("id", toClose);

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }
  return NextResponse.json({ closed: toClose.length });
}
