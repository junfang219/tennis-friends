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
import { createPost } from "../../src/lib/supabase/queries";

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

// The in-chat GameCourtPrompt reports WITH a p_post_id — the game context. The
// RPC then verifies the caller is a participant (author or approved player) and
// that "now" is inside the game window, instead of trusting a GPS reading.
describe.skipIf(!integrationEnvReady)("report_court_availability — game-scoped path (live Supabase)", () => {
  let author: TestUser; // creates the game
  let player: TestUser; // approved participant
  let outsider: TestUser; // not in the game
  let livePostId = ""; // game whose window contains "now"
  let futurePostId = ""; // game that hasn't opened yet
  const courtId = `test-court-game-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Build play_date/play_time in UTC so the window math is independent of the
  // test machine's timezone (we pin play_timezone to "UTC" on the post).
  function utcDateTime(offsetMs: number): { playDate: string; playTime: string } {
    const d = new Date(Date.now() + offsetMs);
    const iso = d.toISOString();
    return { playDate: iso.slice(0, 10), playTime: iso.slice(11, 16) };
  }

  beforeAll(async () => {
    [author, player, outsider] = await Promise.all([
      makeTestUser("cag-author"),
      makeTestUser("cag-player"),
      makeTestUser("cag-outsider"),
    ]);

    // Live game: started 5 min ago, 90-min duration → "now" is inside
    // [start-30, end]. play_timezone UTC so the RPC parses our UTC strings.
    const started = utcDateTime(-5 * 60 * 1000);
    const live = await createPost(author.client, {
      content: "Game-window report test",
      post_type: "find_players",
      play_date: started.playDate,
      play_time: started.playTime,
      play_duration: 90,
      play_timezone: "UTC",
      court_location: "Game Window Court",
      game_type: "singles",
      players_needed: 1,
    });
    livePostId = live.id;

    // Future game: starts in 2 days → "now" is before start-30.
    const soon = utcDateTime(2 * 24 * 60 * 60 * 1000);
    const future = await createPost(author.client, {
      content: "Future game report test",
      post_type: "find_players",
      play_date: soon.playDate,
      play_time: soon.playTime,
      play_duration: 90,
      play_timezone: "UTC",
      court_location: "Game Window Court",
      game_type: "singles",
      players_needed: 1,
    });
    futurePostId = future.id;

    // The join-request RLS requires the post be visible to the requester
    // (can_see_post). Befriend so `player` can see `author`'s game and join.
    await befriend(author, player);

    // Approve `player` on the live game (author approves their own grant).
    const reqIns = await player.client
      .from("play_requests")
      .insert({ post_id: livePostId, user_id: player.id, status: "pending" });
    if (reqIns.error) throw new Error(`play_request insert: ${reqIns.error.message}`);
    const reqUpd = await author.client
      .from("play_requests")
      .update({ status: "approved" })
      .eq("post_id", livePostId)
      .eq("user_id", player.id)
      .select("id, status");
    if (reqUpd.error) throw new Error(`play_request approve: ${reqUpd.error.message}`);
    if (!reqUpd.data || reqUpd.data.length !== 1 || reqUpd.data[0].status !== "approved") {
      throw new Error(`play_request approve affected ${reqUpd.data?.length ?? 0} rows: ${JSON.stringify(reqUpd.data)}`);
    }
  }, 60_000);

  afterAll(async () => {
    const admin = adminClient();
    for (const id of [livePostId, futurePostId].filter(Boolean)) {
      try {
        await admin.from("posts").delete().eq("id", id);
      } catch {
        /* best-effort */
      }
    }
    await deleteTestUsers([author, player, outsider].filter(Boolean));
  }, 60_000);

  it("the author can report inside the game window, linked to the post", async () => {
    const { data, error } = await author.client.rpc("report_court_availability", {
      p_court_id: courtId,
      p_has_empty: true,
      p_post_id: livePostId,
    });
    expect(error).toBeNull();
    expect((data as { ok?: boolean })?.ok).toBe(true);

    const { data: rows } = await adminClient()
      .from("court_availability_reports")
      .select("post_id, has_empty")
      .eq("court_id", courtId)
      .eq("user_id", author.id);
    expect(rows).toHaveLength(1);
    expect(rows![0].post_id).toBe(livePostId);
  });

  it("an approved player can also report for the game", async () => {
    const { error } = await player.client.rpc("report_court_availability", {
      p_court_id: courtId,
      p_has_empty: false,
      p_post_id: livePostId,
    });
    expect(error).toBeNull();
  });

  it("rejects a non-participant", async () => {
    const { error } = await outsider.client.rpc("report_court_availability", {
      p_court_id: courtId,
      p_has_empty: true,
      p_post_id: livePostId,
    });
    expect(error).not.toBeNull();
  });

  it("rejects a report outside the game window", async () => {
    const { error } = await author.client.rpc("report_court_availability", {
      p_court_id: courtId,
      p_has_empty: true,
      p_post_id: futurePostId,
    });
    expect(error).not.toBeNull();
  });
});
