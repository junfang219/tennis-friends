/**
 * One-shot backfill: populate posts.court_facility_id for existing
 * find_players rows by running their court_location through
 * resolveFacilityByName(). Rows that don't resolve stay null and just
 * render as plain text — same behavior as a fresh free-text post.
 *
 * Run with `tsx scripts/backfill-court-facility-id.ts` after applying
 * the migration. Uses the service-role key from .env.local because RLS
 * blocks cross-user writes from the browser client.
 */
import { createClient } from "@supabase/supabase-js";
import { resolveFacilityByName } from "../src/lib/facilities";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const { data: rows, error } = await supabase
    .from("posts")
    .select("id, court_location")
    .eq("post_type", "find_players")
    .is("court_facility_id", null)
    .neq("court_location", "");
  if (error) throw error;

  let matched = 0;
  let scanned = 0;
  for (const row of rows ?? []) {
    scanned++;
    const f = resolveFacilityByName(row.court_location);
    if (!f) continue;
    const { error: upErr } = await supabase
      .from("posts")
      .update({ court_facility_id: f.courtId })
      .eq("id", row.id);
    if (upErr) {
      console.error(`update failed for ${row.id}:`, upErr.message);
      continue;
    }
    matched++;
    console.log(`${row.id}: "${row.court_location}" → ${f.courtId} (${f.name})`);
  }
  console.log(`\nScanned ${scanned}, linked ${matched}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
