import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  anonClient,
  deleteTestUsers,
  integrationEnvReady,
  makeTestUser,
  type TestUser,
} from "./_helpers";

// The manual court-status reporter (CourtStatusReporter) calls
// report_court_availability with NO p_post_id — there's no game context, just
// a signed-in user who tapped "Open courts" / "All full" while standing at the
// venue (proximity is enforced client-side via a single GPS read). These tests
// pin the RPC behaviours that path relies on:
//   1. An authenticated user can report against an arbitrary court_id with no
//      post and the row lands in court_availability_reports.
//   2. A second report from the same user + court within 30 min is deduped
//      (no duplicate row), so spamming the buttons is a no-op.
//   3. A different user reporting the same court is NOT deduped against the
//      first user — each player's report counts once.
//   4. An unauthenticated caller is rejected.
describe.skipIf(!integrationEnvReady)("report_court_availability — manual path (live Supabase)", () => {
  let alice: TestUser;
  let bob: TestUser;
  // Unique, obviously-synthetic court id so we never collide with real catalog
  // reports and our assertions count only rows from this run.
  const courtId = `test-court-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    [alice, bob] = await Promise.all([
      makeTestUser("ca-alice"),
      makeTestUser("ca-bob"),
    ]);
  }, 60_000);

  afterAll(async () => {
    // court_availability_reports.user_id is ON DELETE CASCADE, so deleting the
    // test users removes their reports too — no separate row cleanup needed.
    await deleteTestUsers([alice, bob].filter(Boolean));
  }, 60_000);

  async function reportsFor(userId: string) {
    const { data, error } = await adminClient()
      .from("court_availability_reports")
      .select("id, has_empty, post_id")
      .eq("court_id", courtId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  it("an authenticated user can report with no game context", async () => {
    const { data, error } = await alice.client.rpc("report_court_availability", {
      p_court_id: courtId,
      p_has_empty: true,
    });
    expect(error).toBeNull();
    expect((data as { ok?: boolean })?.ok).toBe(true);

    const rows = await reportsFor(alice.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].has_empty).toBe(true);
    // Manual reports carry no post link.
    expect(rows[0].post_id).toBeNull();
  });

  it("a second report from the same user + court within 30 min is deduped", async () => {
    const { data, error } = await alice.client.rpc("report_court_availability", {
      p_court_id: courtId,
      p_has_empty: false,
    });
    expect(error).toBeNull();
    expect((data as { ok?: boolean; deduped?: boolean })?.deduped).toBe(true);

    // Still exactly one row, and it's the original "true" — the dedupe is a
    // no-op insert, not an overwrite.
    const rows = await reportsFor(alice.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].has_empty).toBe(true);
  });

  it("a different user's report on the same court is counted separately", async () => {
    const { error } = await bob.client.rpc("report_court_availability", {
      p_court_id: courtId,
      p_has_empty: true,
    });
    expect(error).toBeNull();

    const rows = await reportsFor(bob.id);
    expect(rows).toHaveLength(1);
  });

  it("an unauthenticated caller is rejected", async () => {
    const { error } = await anonClient().rpc("report_court_availability", {
      p_court_id: courtId,
      p_has_empty: true,
    });
    expect(error).not.toBeNull();
  });
});
