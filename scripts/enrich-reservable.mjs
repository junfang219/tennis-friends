#!/usr/bin/env node
/**
 * Stamp each court in data/activenet-seattle.json with `reservable: boolean`.
 *
 * Some Seattle Parks tennis courts are drop-in / first-come only: they still
 * return wide-open "availability" from ActiveNet but can't actually be
 * reserved online. ActiveNet flags these per court with `no_internet_permits`
 * in its reservation search. The search is hard-capped at 20 rows and doesn't
 * paginate, so we query it once per center (every venue has <= 20 courts) and
 * map each resource → reservable (= !no_internet_permits).
 *
 * Idempotent: re-run any time to refresh. Courts the search doesn't return
 * (a handful whose availability resource id differs from their reservation id)
 * default to reservable=true so we never wrongly hide a bookable court.
 *
 *   node scripts/enrich-reservable.mjs        # update the seed
 *   node scripts/enrich-reservable.mjs --dry  # report only, don't write
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname, "..", "data", "activenet-seattle.json");
const DRY = process.argv.includes("--dry");

const BASE = "https://anc.apm.activecommunities.com/seattle/rest";
const HEADERS = {
  "Content-Type": "application/json",
  page_info: JSON.stringify({ page_number: 1, total_records_per_page: 50 }),
  "X-Requested-With": "XMLHttpRequest",
};

async function searchCenter(centerId) {
  const body = {
    name: "",
    attendee: 0,
    date_times: [],
    event_type_ids: [],
    facility_type_ids: [],
    reservation_group_ids: [],
    amenity_ids: [],
    facility_id: 0,
    equipment_id: 0,
    center_id: 0,
    resource_type: 0,
    client_coordinate: "",
    order_by_field: "name",
    order_direction: "asc",
    page_size: 50,
    start_index: 0,
    search_client_id: "",
    date_time_length: null,
    full_day_booking: false,
    center_ids: [centerId],
    specify_start_and_end_times: false,
  };
  const res = await fetch(`${BASE}/reservation/resource?locale=en-US`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`center ${centerId}: HTTP ${res.status}`);
  const json = await res.json();
  return json?.body?.items ?? [];
}

const seed = JSON.parse(readFileSync(SEED_PATH, "utf8"));

const reservableById = new Map(); // resourceId -> boolean
for (const venue of seed.venues) {
  try {
    const items = await searchCenter(venue.centerId);
    for (const it of items) reservableById.set(it.id, !it.no_internet_permits);
  } catch (e) {
    console.error(`! ${venue.name}: ${e.message} — leaving its courts as-is`);
  }
}

let reservable = 0;
let nonReservable = 0;
let unknown = 0;
const nonReservableNames = [];
for (const venue of seed.venues) {
  for (const court of venue.courts) {
    if (reservableById.has(court.resourceId)) {
      court.reservable = reservableById.get(court.resourceId);
    } else {
      court.reservable = true; // default: don't hide a possibly-bookable court
      unknown += 1;
    }
    if (court.reservable) reservable += 1;
    else {
      nonReservable += 1;
      nonReservableNames.push(`${venue.name} / ${court.name}`);
    }
  }
}

console.log(
  `reservable=${reservable} | non-reservable=${nonReservable} | unknown(defaulted true)=${unknown}`
);
console.log("\nNon-reservable (drop-in / first-come):");
nonReservableNames.forEach((n) => console.log("  " + n));

if (DRY) {
  console.log("\n--dry: not writing.");
} else {
  seed._source =
    (seed._source || "").replace(/\s*\| reservable flags.*$/, "") +
    " | reservable flags from ActiveNet no_internet_permits (scripts/enrich-reservable.mjs)";
  writeFileSync(SEED_PATH, JSON.stringify(seed, null, 2) + "\n");
  console.log(`\nWrote ${SEED_PATH}`);
}
