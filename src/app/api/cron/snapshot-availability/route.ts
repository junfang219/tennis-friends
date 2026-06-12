import { NextResponse } from "next/server";
import { getSeattleVenues } from "@/lib/activenetSeattleCourts";
import { fetchTimeslots } from "@/lib/activenet";
import { buildSnapshotRows, type SnapshotRow } from "@/lib/courtAvailability";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Inserts } from "@/lib/supabase/types";

/**
 * Nightly snapshot of Seattle Parks court availability.
 *
 * Run late each evening (Pacific) via the pg_cron job
 * `snapshot-availability-nightly`, which calls this route with
 * `Authorization: Bearer <CRON_SECRET>`. For every seeded court it captures the
 * next 15 days of open windows and upserts the BOOKABLE (status-0) days into
 * public.court_availability_snapshot.
 *
 * Why only status-0 days: once a date becomes today it flips to status 7
 * (same-day, no online booking) and ActiveNet returns nothing. Skipping the
 * non-zero statuses means the snapshot from a date's last bookable night
 * survives — that's exactly the frozen schedule /api/courts/availability serves
 * as "today". Future dates get re-captured each night as people book.
 */

export const dynamic = "force-dynamic";
// Snapshotting ~130 courts is well over the default function budget.
export const maxDuration = 120;

const DAYS = 15;
const CONCURRENCY = 8;
const UPSERT_CHUNK = 500;

function seattleToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(
    new Date()
  );
}

/** Date string `n` days after a YYYY-MM-DD (pure calendar arithmetic, UTC-safe). */
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate()
  ).padStart(2, "0")}`;
}

/** Run an async mapper over items with a fixed concurrency cap. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = seattleToday();
  const end = addDays(start, DAYS - 1);

  // Flatten to (center, court) pairs so concurrency spans the whole fleet.
  const jobs = getSeattleVenues().flatMap((v) =>
    v.courts.map((c) => ({ centerId: v.centerId, resourceId: c.resourceId }))
  );

  let courtsOk = 0;
  let courtsErr = 0;
  const rows: SnapshotRow[] = [];

  await mapPool(jobs, CONCURRENCY, async (job) => {
    try {
      const days = await fetchTimeslots(job.resourceId, start, end);
      rows.push(...buildSnapshotRows(job.centerId, job.resourceId, days));
      courtsOk += 1;
    } catch {
      courtsErr += 1;
    }
  });

  const admin = createSupabaseAdminClient();
  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await admin
      .from("court_availability_snapshot")
      .upsert(chunk as unknown as Inserts<"court_availability_snapshot">[], {
        onConflict: "resource_id,date",
      });
    if (error) {
      return NextResponse.json(
        { error: error.message, upsertedBeforeError: upserted },
        { status: 500 }
      );
    }
    upserted += chunk.length;
  }

  return NextResponse.json({
    range: { start, end },
    courtsOk,
    courtsErr,
    rowsUpserted: upserted,
  });
}
