import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  deleteTestUsers,
  integrationEnvReady,
  makeTestUser,
  type TestUser,
} from "./_helpers";

// Availability-poll RLS + happy-path integration test.
//
// Personas:
//   alice — group owner (always captain by virtue of ownership)
//   bob   — member (no roles)
//   carol — non-member of the group

describe.skipIf(!integrationEnvReady)("availability_polls (live Supabase)", () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let groupId: string;
  let pollId: string;

  beforeAll(async () => {
    [alice, bob, carol] = await Promise.all([
      makeTestUser("ap-alice"),
      makeTestUser("ap-bob"),
      makeTestUser("ap-carol"),
    ]);
    const admin = adminClient();
    const { data: g } = await admin
      .from("groups")
      .insert({ name: "Poll Test Team", owner_id: alice.id })
      .select("id")
      .single();
    groupId = g!.id;
    // owner row auto-added by trigger; add bob as a plain member.
    await admin
      .from("group_members")
      .insert({ group_id: groupId, user_id: bob.id, roles: [] });
  }, 60_000);

  afterAll(async () => {
    if (groupId) await adminClient().from("groups").delete().eq("id", groupId);
    if (alice || bob || carol) await deleteTestUsers([alice, bob, carol].filter(Boolean));
  }, 60_000);

  it("captain (owner) can insert a poll; non-captain members and non-members cannot", async () => {
    const candidate = ["2026-08-08", "2026-08-09"];

    // Alice (owner) creates the poll.
    const aliceIns = await alice.client
      .from("availability_polls")
      .insert({
        group_id: groupId,
        created_by_id: alice.id,
        candidate_dates: candidate,
        min_players: 2,
      })
      .select("id, status, candidate_dates")
      .single();
    expect(aliceIns.error).toBeNull();
    expect(aliceIns.data?.status).toBe("open");
    pollId = aliceIns.data!.id;

    // Plain member bob cannot insert.
    const bobIns = await bob.client
      .from("availability_polls")
      .insert({
        group_id: groupId,
        created_by_id: bob.id,
        candidate_dates: candidate,
        min_players: 2,
      });
    expect(bobIns.error).not.toBeNull();

    // Non-member carol cannot insert either.
    const carolIns = await carol.client
      .from("availability_polls")
      .insert({
        group_id: groupId,
        created_by_id: carol.id,
        candidate_dates: candidate,
        min_players: 2,
      });
    expect(carolIns.error).not.toBeNull();
  });

  it("group members can SELECT the poll; non-members cannot", async () => {
    const aliceView = await alice.client
      .from("availability_polls").select("id").eq("id", pollId);
    expect(aliceView.data?.length).toBe(1);

    const bobView = await bob.client
      .from("availability_polls").select("id").eq("id", pollId);
    expect(bobView.data?.length).toBe(1);

    const carolView = await carol.client
      .from("availability_polls").select("id").eq("id", pollId);
    expect(carolView.data?.length).toBe(0);
  });

  it("a member can upsert their own response, and re-upsert (UPDATE path)", async () => {
    const ins = await bob.client
      .from("availability_poll_responses")
      .insert({
        poll_id: pollId,
        user_id: bob.id,
        blocks: [{ date: "2026-08-08", start: "09:00", end: "11:00" }],
      });
    expect(ins.error).toBeNull();

    const update = await bob.client
      .from("availability_poll_responses")
      .upsert(
        {
          poll_id: pollId,
          user_id: bob.id,
          blocks: [
            { date: "2026-08-08", start: "09:00", end: "12:00" },
            { date: "2026-08-09", start: "14:00", end: "16:00" },
          ],
        },
        { onConflict: "poll_id,user_id" },
      );
    expect(update.error).toBeNull();

    const verify = await bob.client
      .from("availability_poll_responses")
      .select("blocks")
      .eq("poll_id", pollId)
      .eq("user_id", bob.id)
      .single();
    expect(verify.data?.blocks).toEqual([
      { date: "2026-08-08", start: "09:00", end: "12:00" },
      { date: "2026-08-09", start: "14:00", end: "16:00" },
    ]);
  });

  it("a member cannot insert a response on someone else's behalf", async () => {
    const { error } = await bob.client
      .from("availability_poll_responses")
      .insert({
        poll_id: pollId,
        user_id: alice.id,
        blocks: [{ date: "2026-08-08", start: "10:00", end: "12:00" }],
      });
    expect(error).not.toBeNull();
  });

  it("non-members cannot read or write responses", async () => {
    const view = await carol.client
      .from("availability_poll_responses")
      .select("id")
      .eq("poll_id", pollId);
    expect(view.data?.length).toBe(0);

    const ins = await carol.client
      .from("availability_poll_responses")
      .insert({
        poll_id: pollId,
        user_id: carol.id,
        blocks: [],
      });
    expect(ins.error).not.toBeNull();
  });

  it("only captains can close a poll and link the resulting match", async () => {
    // bob (plain member) tries to close — RLS update policy denies.
    const bobClose = await bob.client
      .from("availability_polls")
      .update({ status: "closed" })
      .eq("id", pollId)
      .select("id");
    // RLS UPDATE returning 0 affected rows is silent; check the row didn't change.
    const after = await adminClient()
      .from("availability_polls")
      .select("status")
      .eq("id", pollId)
      .single();
    expect(after.data?.status).toBe("open");
    expect(bobClose.data?.length ?? 0).toBe(0);

    // Alice (owner = captain) closes successfully.
    const aliceClose = await alice.client
      .from("availability_polls")
      .update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("id", pollId);
    expect(aliceClose.error).toBeNull();

    const final = await adminClient()
      .from("availability_polls")
      .select("status")
      .eq("id", pollId)
      .single();
    expect(final.data?.status).toBe("closed");
  });

  it("inserting a response into a closed poll is denied by RLS", async () => {
    // Even the owner can't because the policy gates on status = 'open'.
    const { error } = await alice.client
      .from("availability_poll_responses")
      .insert({
        poll_id: pollId,
        user_id: alice.id,
        blocks: [],
      });
    expect(error).not.toBeNull();
  });

  it("deleting the group cascades to polls and responses", async () => {
    // Spin up a fresh group + poll + response to verify the cascade.
    const admin = adminClient();
    const { data: g } = await admin
      .from("groups")
      .insert({ name: "Cascade Test", owner_id: alice.id })
      .select("id")
      .single();
    const localGroupId = g!.id;
    const { data: p } = await admin
      .from("availability_polls")
      .insert({
        group_id: localGroupId,
        created_by_id: alice.id,
        candidate_dates: ["2026-08-15"],
      })
      .select("id")
      .single();
    const localPollId = p!.id;
    await admin
      .from("availability_poll_responses")
      .insert({
        poll_id: localPollId,
        user_id: alice.id,
        blocks: [{ date: "2026-08-15", start: "09:00", end: "11:00" }],
      });

    await admin.from("groups").delete().eq("id", localGroupId);

    const remainingPoll = await admin
      .from("availability_polls")
      .select("id")
      .eq("id", localPollId);
    expect(remainingPoll.data?.length).toBe(0);

    const remainingResp = await admin
      .from("availability_poll_responses")
      .select("id")
      .eq("poll_id", localPollId);
    expect(remainingResp.data?.length).toBe(0);
  });
});
