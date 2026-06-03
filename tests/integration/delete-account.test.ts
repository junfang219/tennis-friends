import { afterEach, describe, expect, it } from "vitest";
import {
  adminClient,
  anonClient,
  deleteTestUsers,
  integrationEnvReady,
  makeTestUser,
  type TestUser,
} from "./_helpers";

// Verifies the delete_my_account RPC that powers the user-facing
// Settings → Danger zone → Delete account flow. The RPC must:
//   - require an authenticated caller (auth.uid() must resolve)
//   - clear RESTRICT-blocking rows owned by the caller (groups, polls,
//     events, …) so a subsequent auth.users delete can cascade through
//   - only touch the caller's rows — never another user's
//
// We exercise the RPC directly rather than going through the
// /api/account/delete handler because the route is glue (RPC + storage
// cleanup + auth.admin.deleteUser); cleanupUserStorage has its own unit
// test, and auth.admin.deleteUser is Supabase SDK code we don't own.

describe.skipIf(!integrationEnvReady)("delete_my_account RPC", () => {
  const cleanup: TestUser[] = [];

  afterEach(async () => {
    await deleteTestUsers(cleanup.splice(0));
  });

  it("rejects an unauthenticated caller", async () => {
    const { error } = await anonClient().rpc("delete_my_account");
    expect(error).not.toBeNull();
    // Postgres ERRCODE 42501 = insufficient_privilege, which we map to
    // "Not signed in" — surface either form so a Supabase code rename
    // doesn't break the test.
    expect(`${error?.message} ${error?.code ?? ""}`.toLowerCase()).toMatch(
      /not signed in|42501|insufficient/,
    );
  });

  it("clears RESTRICT-blocking rows the caller owns and lets auth.users delete cascade", async () => {
    const owner = await makeTestUser("delacc-owner");
    cleanup.push(owner);
    const admin = adminClient();

    // Seed a group, an event, and a poll — each is RESTRICT-blocked by
    // the owner. Before the RPC, deleting the auth user would error
    // with a foreign key violation; afterward the user is gone and so
    // are these rows.
    const { data: group, error: groupErr } = await owner.client
      .from("groups")
      .insert({ name: "Delete-me FC", owner_id: owner.id })
      .select("id")
      .single();
    if (groupErr || !group) throw new Error(`group insert: ${groupErr?.message}`);

    const { data: event, error: eventErr } = await owner.client
      .from("events")
      .insert({
        owner_id: owner.id,
        title: "Delete-me clinic",
        event_type: "clinic",
        start_date: new Date(Date.now() + 86_400_000).toISOString(),
        end_date: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    if (eventErr || !event) throw new Error(`event insert: ${eventErr?.message}`);

    const { data: poll, error: pollErr } = await owner.client
      .from("polls")
      .insert({ question: "Delete me?", created_by_id: owner.id })
      .select("id")
      .single();
    if (pollErr || !poll) throw new Error(`poll insert: ${pollErr?.message}`);

    const { error: rpcError } = await owner.client.rpc("delete_my_account");
    expect(rpcError).toBeNull();

    for (const [table, id] of [
      ["groups", group.id],
      ["events", event.id],
      ["polls", poll.id],
    ] as const) {
      const { data } = await admin.from(table).select("id").eq("id", id);
      expect(data ?? []).toHaveLength(0);
    }

    // Now the auth.users delete (what /api/account/delete calls next)
    // must succeed — no RESTRICT FK left to block it. This also doubles
    // as test cleanup so we don't leak the user via deleteTestUsers.
    const { error: delErr } = await admin.auth.admin.deleteUser(owner.id);
    expect(delErr).toBeNull();
    cleanup.length = 0;
  });

  it("only touches the caller's rows — another user's groups stay intact", async () => {
    const alice = await makeTestUser("delacc-alice");
    const bob = await makeTestUser("delacc-bob");
    cleanup.push(alice, bob);
    const admin = adminClient();

    const { data: aliceGroup } = await alice.client
      .from("groups")
      .insert({ name: "Alice FC", owner_id: alice.id })
      .select("id")
      .single();
    const { data: bobGroup } = await bob.client
      .from("groups")
      .insert({ name: "Bob FC", owner_id: bob.id })
      .select("id")
      .single();
    if (!aliceGroup || !bobGroup) throw new Error("seed failed");

    const { error: rpcError } = await alice.client.rpc("delete_my_account");
    expect(rpcError).toBeNull();

    const { data: aliceCheck } = await admin
      .from("groups")
      .select("id")
      .eq("id", aliceGroup.id);
    expect(aliceCheck ?? []).toHaveLength(0);

    const { data: bobCheck } = await admin
      .from("groups")
      .select("id")
      .eq("id", bobGroup.id);
    expect(bobCheck ?? []).toHaveLength(1);
  });
});
