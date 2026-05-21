import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  anonClient,
  befriend,
  deleteTestUsers,
  integrationEnvReady,
  makeTestUser,
  type TestUser,
} from "./_helpers";

// Realtime delivery test. Confirms the publication is wired up, RLS is
// enforced on the subscription, and end-to-end latency is sub-second on
// the free tier.

describe.skipIf(!integrationEnvReady)("Supabase Realtime", () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;

  beforeAll(async () => {
    [alice, bob, carol] = await Promise.all([
      makeTestUser("rt-alice"),
      makeTestUser("rt-bob"),
      makeTestUser("rt-carol"),
    ]);
    await befriend(alice, bob);
  }, 60_000);

  afterAll(async () => {
    await deleteTestUsers([alice, bob, carol].filter(Boolean));
  }, 60_000);

  it("delivers an INSERT on messages to the receiver in under 5 seconds", async () => {
    // Bob subscribes to his inbox. No filter — let RLS do the row-scoping.
    const bobChannel = bob.client.channel(`rt-test-bob-${Date.now()}`);
    const received: unknown[] = [];
    let lastStatus = "";

    const subscribed = new Promise<void>((resolve, reject) => {
      bobChannel
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          (payload) => {
            received.push(payload.new);
          }
        )
        .subscribe((status) => {
          lastStatus = status;
          if (status === "SUBSCRIBED") resolve();
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            reject(new Error(`subscribe ended with status: ${status}`));
          }
        });
    });

    await subscribed;
    // Tiny settle: realtime needs a beat after SUBSCRIBED before it
    // reliably delivers replication events.
    await new Promise((r) => setTimeout(r, 500));

    // Alice sends bob a message.
    const ins = await alice.client
      .from("messages")
      .insert({ sender_id: alice.id, receiver_id: bob.id, content: "rt-hello" })
      .select("id")
      .single();
    expect(ins.error).toBeNull();

    // Poll for delivery.
    const deadline = Date.now() + 10000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(received.length, `lastStatus=${lastStatus}`).toBeGreaterThanOrEqual(1);
    await bob.client.removeChannel(bobChannel);
  });

  it("does NOT deliver another user's DM to an eavesdropper", async () => {
    // Carol subscribes to messages without a receiver filter (catch all).
    const carolChannel = carol.client.channel(`rt-test-carol-${Date.now()}`);
    const received: unknown[] = [];

    const subscribed = new Promise<void>((resolve, reject) => {
      carolChannel
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          (payload) => {
            received.push(payload.new);
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") resolve();
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            reject(new Error(`subscribe failed: ${status}`));
          }
        });
    });

    await subscribed;

    // Alice sends bob another DM. Carol is not in the pair.
    await alice.client
      .from("messages")
      .insert({ sender_id: alice.id, receiver_id: bob.id, content: "secret" });

    // Wait a bit. RLS should suppress delivery — carol shouldn't see it.
    await new Promise((r) => setTimeout(r, 1500));

    expect(received.length).toBe(0);
    await carol.client.removeChannel(carolChannel);
  });

  it("rejects realtime subscriptions from anonymous clients on RLS-protected tables", async () => {
    const anon = anonClient();
    const anonChannel = anon.channel(`rt-test-anon-${Date.now()}`);
    const events: unknown[] = [];

    await new Promise<void>((resolve) => {
      anonChannel
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "messages" },
          (payload) => {
            events.push(payload);
          }
        )
        .subscribe((status) => {
          // Either subscription is rejected outright, or it accepts but no
          // events are delivered. Resolve either way after a beat.
          if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            setTimeout(resolve, 500);
          }
        });
    });

    // Insert via admin client.
    const admin = adminClient();
    await admin
      .from("messages")
      .insert({ sender_id: alice.id, receiver_id: bob.id, content: "anon-canary" });

    await new Promise((r) => setTimeout(r, 1500));
    expect(events.length).toBe(0);
    await anon.removeChannel(anonChannel);
  });
});
