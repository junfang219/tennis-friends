#!/usr/bin/env node
/**
 * Accuracy check for the court-availability pipeline.
 *
 * For a sample of (venue, date) pairs it compares, per court:
 *   • EXPECTED — open windows derived fresh from the raw ActiveNet endpoint
 *     (the authoritative source the app is built on), applying the same
 *     "available && >= 30 min" rule the API route uses.
 *   • ACTUAL   — what our own /api/courts/availability route serves.
 *
 * A mismatch means our route/parser/filter has drifted from the source (a
 * real regression). Because live bookings shift minute-to-minute, any first
 * mismatch is re-checked once before being reported, so a booking landing
 * mid-run doesn't cause a false failure. Exits non-zero if anything still
 * disagrees — wire it into CI or run it by hand after touching the pipeline.
 *
 * What it does NOT verify: that ActiveNet itself matches the Seattle Parks
 * website's view-only grid (e.g. same-day status-7 days). Both our route and
 * this script read the same ActiveNet endpoint, so that layer needs a manual
 * spot-check against the official site.
 *
 * Usage:
 *   npm run verify:availability                 # default sample vs localhost:3000
 *   APP_URL=https://mytennisfriends.com npm run verify:availability
 *   node scripts/verify-availability.mjs 2,13 0,1,7   # centers, day-offsets
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(
  readFileSync(join(__dirname, "..", "data", "activenet-seattle.json"), "utf8")
);

const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const ANET_BASE = "https://anc.apm.activecommunities.com/seattle/rest";
const PAGE_INFO = {
  page_info: JSON.stringify({ page_number: 1, total_records_per_page: 20 }),
  "X-Requested-With": "XMLHttpRequest",
};
const MIN_SLOT_MINUTES = 30; // keep in sync with the API route

// Sample to check: CLI args override the defaults.
//   argv[2] = comma-separated center IDs, argv[3] = comma-separated day offsets
const centers = (process.argv[2] || "2,13,20")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter(Boolean);
const dayOffsets = (process.argv[3] || "0,1,7")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}
function dateForOffset(off) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + off);
  return ymd(d);
}
function slotMinutes(start, end) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}
function windowKey(s) {
  return `${s.startTime}-${s.endTime}`;
}

/** EXPECTED: open windows straight from ActiveNet for one resource/day. */
async function rawWindows(resourceId, date) {
  const url = `${ANET_BASE}/reservation/resource/availability/daily/${resourceId}?start_date=${date}&end_date=${date}&locale=en-US`;
  const res = await fetch(url, { headers: PAGE_INFO });
  if (!res.ok) throw new Error(`ActiveNet ${res.status} for ${resourceId}`);
  const json = await res.json();
  const day = json?.body?.details?.daily_details?.[0];
  const times = day?.times ?? [];
  const keys = times
    .filter((t) => t.available !== false)
    .map((t) => ({ startTime: t.start_time, endTime: t.end_time }))
    .filter((s) => s.startTime && s.endTime && slotMinutes(s.startTime, s.endTime) >= MIN_SLOT_MINUTES)
    .map(windowKey);
  return { keys: new Set(keys), status: day?.status ?? null };
}

/** ACTUAL: our route's output for a whole center/day. */
async function appCourts(center, date) {
  const res = await fetch(`${APP_URL}/api/courts/availability?center=${center}&date=${date}`);
  if (!res.ok) throw new Error(`app route ${res.status} for center ${center}`);
  const data = await res.json();
  const byResource = new Map();
  for (const c of data.courts) {
    byResource.set(c.resourceId, new Set((c.slots ?? []).map(windowKey)));
  }
  return { byResource, dayStatus: data.dayStatus ?? null };
}

function diffSets(expected, actual) {
  const missing = [...expected].filter((k) => !actual.has(k)); // in source, not in app
  const extra = [...actual].filter((k) => !expected.has(k)); // in app, not in source
  return { missing, extra };
}

let totalCourts = 0;
let totalWindows = 0;
const failures = [];

for (const center of centers) {
  const venue = seed.venues.find((v) => v.centerId === center);
  if (!venue) {
    console.log(`! center ${center} not in seed — skipping`);
    continue;
  }
  for (const off of dayOffsets) {
    const date = dateForOffset(off);
    let app;
    try {
      app = await appCourts(center, date);
    } catch (e) {
      failures.push({ center, date, court: "(route)", note: String(e.message || e) });
      console.log(`FAIL  center ${center} ${date} — route error: ${e.message || e}`);
      continue;
    }

    let dayWindows = 0;
    const dayFails = [];
    for (const court of venue.courts) {
      const expected = await rawWindows(court.resourceId, date);
      const actual = app.byResource.get(court.resourceId) ?? new Set();
      let { missing, extra } = diffSets(expected.keys, actual);
      totalCourts += 1;
      dayWindows += actual.size;

      // Race mitigation: a booking landing mid-run can desync the two reads.
      // Re-fetch both once; only a persistent diff is a real failure.
      if (missing.length || extra.length) {
        const expected2 = await rawWindows(court.resourceId, date);
        const app2 = await appCourts(center, date);
        const actual2 = app2.byResource.get(court.resourceId) ?? new Set();
        ({ missing, extra } = diffSets(expected2.keys, actual2));
        if (missing.length || extra.length) {
          dayFails.push({ court: court.name, missing, extra });
        }
      }
    }
    totalWindows += dayWindows;

    const statusNote =
      app.dayStatus !== 0 && app.dayStatus != null
        ? ` [dayStatus=${app.dayStatus}, view-only]`
        : "";
    if (dayFails.length === 0) {
      console.log(
        `PASS  center ${center} ${date} — ${venue.courts.length} courts, ${dayWindows} windows${statusNote}`
      );
    } else {
      console.log(`FAIL  center ${center} ${date}${statusNote}`);
      for (const f of dayFails) {
        if (f.missing.length) console.log(`        ${f.court}: in source, not in app: ${f.missing.join(", ")}`);
        if (f.extra.length) console.log(`        ${f.court}: in app, not in source: ${f.extra.join(", ")}`);
        failures.push({ center, date, ...f });
      }
    }
  }
}

console.log(
  `\n${failures.length === 0 ? "✓ OK" : "✗ MISMATCH"} — checked ${totalCourts} court-days, ${totalWindows} windows; ${failures.length} ${failures.length === 1 ? "discrepancy" : "discrepancies"}`
);
process.exit(failures.length === 0 ? 0 : 1);
