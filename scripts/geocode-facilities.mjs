#!/usr/bin/env node
/**
 * Idempotent geocoder for data/tennis_courts.json.
 *
 * Fills in `latitude` / `longitude` for any venue still missing them by
 * querying Nominatim (OpenStreetMap). Venues that already have coordinates
 * — whether geocoded previously or hand-entered — are left alone, so it's
 * safe to re-run any time you add new venues to the source file.
 *
 * The source file IS the canonical store. Hand-fix any addresses Nominatim
 * mis-resolves by pasting accurate lat/lng directly into the venue's row;
 * subsequent runs of this script will respect those values.
 *
 * Failures are written to data/geocode_failures.json for follow-up.
 *
 * Rate limit: Nominatim's usage policy is max 1 request/second; we pace at
 * ~1.1s/req and send a custom User-Agent (also required by their policy).
 *
 * Usage: npm run geocode:facilities
 */

import { readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SOURCE = resolve(ROOT, "data/tennis_courts.json");
const FAILURES = resolve(ROOT, "data/geocode_failures.json");

const USER_AGENT = "TennisFriend/1.0 (junfang219@gmail.com)";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const THROTTLE_MS = 1100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geocodeOne(address) {
  const url = `${NOMINATIM}?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=us`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json) || json.length === 0) return null;
  const { lat, lon } = json[0];
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

async function saveSource(dataset) {
  await writeFile(SOURCE, JSON.stringify(dataset, null, 2) + "\n", "utf8");
}

async function main() {
  const dataset = JSON.parse(await readFile(SOURCE, "utf8"));
  const todo = dataset.venues.filter(
    (v) => v.latitude == null || v.longitude == null
  );

  console.log(`${dataset.venues.length} total venues; ${todo.length} need geocoding.`);
  if (todo.length === 0) {
    // Clear any stale failures file from a prior run.
    if (existsSync(FAILURES)) await unlink(FAILURES);
    return;
  }

  const failures = [];
  let done = 0;
  for (const v of todo) {
    try {
      const coords = await geocodeOne(v.address);
      if (coords) {
        v.latitude = coords.latitude;
        v.longitude = coords.longitude;
      } else {
        failures.push({ id: v.id, name: v.name, address: v.address, reason: "no result" });
      }
    } catch (err) {
      failures.push({
        id: v.id,
        name: v.name,
        address: v.address,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
    done += 1;
    if (done % 20 === 0 || done === todo.length) {
      // Periodic checkpoint so a crash doesn't lose progress.
      await saveSource(dataset);
      console.log(`  progress: ${done}/${todo.length} (failures so far: ${failures.length})`);
    }
    await sleep(THROTTLE_MS);
  }

  await saveSource(dataset);

  if (failures.length > 0) {
    await writeFile(FAILURES, JSON.stringify(failures, null, 2) + "\n", "utf8");
    console.warn(`\n${failures.length} addresses failed. See ${FAILURES}.`);
    console.warn("Paste accurate lat/lng directly into data/tennis_courts.json for each.");
  } else {
    if (existsSync(FAILURES)) await unlink(FAILURES);
    console.log("\nAll addresses geocoded.");
  }

  const ok = dataset.venues.filter((v) => v.latitude != null).length;
  console.log(`Final: ${ok}/${dataset.venues.length} venues have coordinates.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
