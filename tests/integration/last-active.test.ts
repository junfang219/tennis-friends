import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  deleteTestUsers,
  integrationEnvReady,
  makeTestUser,
  type TestUser,
} from "./_helpers";
import { getMyProfile, touchLastActive } from "../../src/lib/supabase/queries/profiles";

// last_active is a presence heartbeat distinct from updated_at. These tests
// pin the two behaviours the migration depends on:
//   1. touchLastActive stamps last_active for the signed-in user (RLS allows
//      the self-update).
//   2. The profiles_updated_at trigger is scoped so a last_active-only write
//      does NOT bump updated_at (otherwise "recently active" and "recently
//      edited" would collapse into the same signal).
describe.skipIf(!integrationEnvReady)("profiles.last_active (live Supabase)", () => {
  let alice: TestUser;

  beforeAll(async () => {
    alice = await makeTestUser("la-alice");
  }, 60_000);

  afterAll(async () => {
    await deleteTestUsers([alice].filter(Boolean));
  }, 60_000);

  it("new profiles have last_active populated by default", async () => {
    const me = await getMyProfile(alice.client);
    expect(me?.last_active).toBeTruthy();
  });

  it("touchLastActive advances last_active without bumping updated_at", async () => {
    // Park last_active and updated_at in the past via the admin client so the
    // heartbeat has somewhere to advance from. Set both in one update; the
    // trigger fires here (last_active is changing) but we overwrite updated_at
    // explicitly so the starting point is deterministic.
    const past = "2025-01-01T00:00:00.000Z";
    await adminClient()
      .from("profiles")
      .update({ last_active: past, updated_at: past })
      .eq("id", alice.id);

    const before = await getMyProfile(alice.client);
    expect(before?.last_active).toBeTruthy();
    const updatedAtBefore = before!.updated_at;

    await touchLastActive(alice.client);

    const after = await getMyProfile(alice.client);
    // last_active moved forward...
    expect(new Date(after!.last_active).getTime()).toBeGreaterThan(
      new Date(past).getTime()
    );
    // ...but updated_at stayed put (trigger skipped the heartbeat write).
    expect(after!.updated_at).toBe(updatedAtBefore);
  });

  it("a real content edit still bumps updated_at", async () => {
    const past = "2025-01-01T00:00:00.000Z";
    await adminClient()
      .from("profiles")
      .update({ updated_at: past })
      .eq("id", alice.id);
    // ^ updated_at only — last_active unchanged, so this very write also bumps
    // updated_at back to now() via the trigger. Re-read to capture the real
    // baseline rather than assuming `past`.
    const baseline = (await getMyProfile(alice.client))!.updated_at;

    await alice.client.from("profiles").update({ bio: "edited bio" }).eq("id", alice.id);

    const after = await getMyProfile(alice.client);
    expect(after!.bio).toBe("edited bio");
    expect(new Date(after!.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(baseline).getTime()
    );
  });
});
