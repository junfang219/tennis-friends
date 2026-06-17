import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  anonClient,
  deleteTestUsers,
  integrationEnvReady,
  makeTestUser,
  type TestUser,
} from "./_helpers";

// Coverage for migrations 0019 / 0020 (guest roster placeholders + claim).
//
// A captain can add account-less "placeholder" roster members, share a
// per-person link, and a guest can RSVP via the anon RPCs without an account.
// When the guest later signs up, claim_roster_placeholder converts the slot
// (or merges into an existing membership, existing answer wins).

describe.skipIf(!integrationEnvReady)("guest roster placeholders (migrations 0019 / 0020)", () => {
  let alice: TestUser; // captain / owner of the main group
  let bob: TestUser; // real member of the main group
  let carol: TestUser; // stranger — owns a second group; later claims a slot

  let groupId: string;
  let matchId: string;
  let practiceId: string;
  let bobMemberId: string;

  let otherGroupId: string;
  let otherMatchId: string;

  // Placeholders created in test 1, reused downstream.
  let ghostOne: { id: string; name: string; token: string };
  let ghostTwo: { id: string; name: string; token: string };

  beforeAll(async () => {
    [alice, bob, carol] = await Promise.all([
      makeTestUser("rp-alice"),
      makeTestUser("rp-bob"),
      makeTestUser("rp-carol"),
    ]);

    const admin = adminClient();

    // Main group: alice owner (auto-added), bob a plain member.
    const { data: g } = await alice.client
      .from("groups")
      .insert({ name: "Placeholder Test", owner_id: alice.id })
      .select("id")
      .single();
    groupId = g!.id;
    const { data: bm } = await admin
      .from("group_members")
      .insert({ group_id: groupId, user_id: bob.id, roles: [] })
      .select("id")
      .single();
    bobMemberId = bm!.id;

    const { data: m } = await alice.client
      .from("team_matches")
      .insert({ group_id: groupId, match_date: "2026-09-01", match_time: "18:00", location: "Magnuson" })
      .select("id")
      .single();
    matchId = m!.id;

    const { data: ps } = await alice.client
      .from("practice_series")
      .insert({ group_id: groupId, name: "Drills", practice_time: "19:00", location: "Woodland" })
      .select("id")
      .single();
    const { data: tp } = await alice.client
      .from("team_practices")
      .insert({ series_id: ps!.id, practice_date: "2026-09-02" })
      .select("id")
      .single();
    practiceId = tp!.id;

    // A second, unrelated group (owned by carol) for the IDOR check.
    const { data: og } = await carol.client
      .from("groups")
      .insert({ name: "Other Team", owner_id: carol.id })
      .select("id")
      .single();
    otherGroupId = og!.id;
    const { data: om } = await carol.client
      .from("team_matches")
      .insert({ group_id: otherGroupId, match_date: "2026-09-03", match_time: "18:00", location: "Elsewhere" })
      .select("id")
      .single();
    otherMatchId = om!.id;
  }, 90_000);

  afterAll(async () => {
    const admin = adminClient();
    if (groupId) await admin.from("groups").delete().eq("id", groupId);
    if (otherGroupId) await admin.from("groups").delete().eq("id", otherGroupId);
    await deleteTestUsers([alice, bob, carol].filter(Boolean));
  }, 90_000);

  it("captain can add placeholder members; non-captain cannot", async () => {
    const { data, error } = await alice.client.rpc("add_roster_placeholders", {
      p_group_id: groupId,
      p_people: [{ name: "Ghost One" }, { name: "Ghost Two", email: "ghost2@example.com" }],
    });
    expect(error).toBeNull();
    const created = (data ?? []) as unknown as { id: string; name: string; token: string }[];
    expect(created).toHaveLength(2);
    ghostOne = created.find((p) => p.name === "Ghost One")!;
    ghostTwo = created.find((p) => p.name === "Ghost Two")!;
    expect(ghostOne.token).toBeTruthy();

    // Rows exist as placeholders: user_id null, claim_token set.
    const admin = adminClient();
    const { data: rows } = await admin
      .from("group_members")
      .select("id, user_id, placeholder_name, claim_token")
      .eq("group_id", groupId)
      .not("placeholder_name", "is", null);
    expect(rows?.length).toBe(2);
    for (const r of rows ?? []) {
      expect(r.user_id).toBeNull();
      expect(r.claim_token).toBeTruthy();
    }

    // A plain member cannot create placeholders.
    const { error: bobErr } = await bob.client.rpc("add_roster_placeholders", {
      p_group_id: groupId,
      p_people: [{ name: "Sneaky" }],
    });
    expect(bobErr).not.toBeNull();
  });

  it("guest can RSVP via token; an event from another group is rejected (IDOR)", async () => {
    const anon = anonClient();
    const { error } = await anon.rpc("guest_set_availability", {
      p_token: ghostOne.token,
      p_event_kind: "match",
      p_event_id: matchId,
      p_status: "playing",
      p_match_types: "singles",
    });
    expect(error).toBeNull();

    const admin = adminClient();
    const { data: row } = await admin
      .from("availabilities")
      .select("status, user_id, member_id")
      .eq("match_id", matchId)
      .eq("member_id", ghostOne.id)
      .single();
    expect(row?.status).toBe("playing");
    expect(row?.user_id).toBeNull();

    // The same token cannot touch an event in a different group.
    const { error: idorErr } = await anon.rpc("guest_set_availability", {
      p_token: ghostOne.token,
      p_event_kind: "match",
      p_event_id: otherMatchId,
      p_status: "playing",
    });
    expect(idorErr).not.toBeNull();
  });

  it("guest_roster_view exposes counts + the guest's own name, never other members'", async () => {
    // bob (a real member) RSVPs playing to the same match.
    await bob.client.from("availabilities").upsert(
      { event_kind: "match", match_id: matchId, member_id: bobMemberId, user_id: bob.id, status: "playing" },
      { onConflict: "match_id,member_id" }
    );

    const anon = anonClient();
    const { data, error } = await anon.rpc("guest_roster_view", { p_token: ghostOne.token });
    expect(error).toBeNull();
    const view = data as unknown as {
      group: { name: string };
      member: { name: string };
      matches: { id: string; my_status: string | null; counts: { playing: number } }[];
    };
    expect(view.group.name).toBe("Placeholder Test");
    expect(view.member.name).toBe("Ghost One");
    const mv = view.matches.find((m) => m.id === matchId)!;
    expect(mv.my_status).toBe("playing");
    expect(mv.counts.playing).toBeGreaterThanOrEqual(2); // ghostOne + bob

    // Privacy: no other member's profile name leaks into the guest payload.
    const blob = JSON.stringify(view);
    expect(blob).not.toContain("rp-bob");
    expect(blob).not.toContain(bob.id);
  });

  it("claim converts a placeholder in place when the caller is not yet a member", async () => {
    // Give Ghost Two an RSVP first so we can prove it re-points to the account.
    const anon = anonClient();
    await anon.rpc("guest_set_availability", {
      p_token: ghostTwo.token,
      p_event_kind: "practice",
      p_event_id: practiceId,
      p_status: "playing",
    });

    // carol is not a member of the main group → convert path.
    const { data, error } = await carol.client.rpc("claim_roster_placeholder", { p_token: ghostTwo.token });
    expect(error).toBeNull();
    const res = data as unknown as { group_id: string; merged_existing: boolean };
    expect(res.merged_existing).toBe(false);
    expect(res.group_id).toBe(groupId);

    const admin = adminClient();
    // The same member row now belongs to carol; placeholder fields cleared.
    const { data: row } = await admin
      .from("group_members")
      .select("user_id, placeholder_name, claim_token")
      .eq("id", ghostTwo.id)
      .single();
    expect(row?.user_id).toBe(carol.id);
    expect(row?.placeholder_name).toBeNull();
    expect(row?.claim_token).toBeNull();

    // The prior guest RSVP now carries carol's user_id, same member_id.
    const { data: avail } = await admin
      .from("availabilities")
      .select("user_id, member_id")
      .eq("practice_id", practiceId)
      .eq("member_id", ghostTwo.id)
      .single();
    expect(avail?.user_id).toBe(carol.id);
  });

  it("claim merges into an existing membership; existing answer wins on collision", async () => {
    // New placeholder that bob (already a member) will claim.
    const { data: added } = await alice.client.rpc("add_roster_placeholders", {
      p_group_id: groupId,
      p_people: [{ name: "Ghost Bob" }],
    });
    const ghostBob = ((added ?? []) as unknown as { id: string; token: string }[])[0];

    const anon = anonClient();
    // Collision: Ghost Bob says "not_playing" to the MATCH bob already answered "playing".
    await anon.rpc("guest_set_availability", {
      p_token: ghostBob.token,
      p_event_kind: "match",
      p_event_id: matchId,
      p_status: "not_playing",
    });
    // Non-collision: Ghost Bob answers the PRACTICE, which bob has not.
    await anon.rpc("guest_set_availability", {
      p_token: ghostBob.token,
      p_event_kind: "practice",
      p_event_id: practiceId,
      p_status: "maybe",
    });

    const { data, error } = await bob.client.rpc("claim_roster_placeholder", { p_token: ghostBob.token });
    expect(error).toBeNull();
    expect((data as unknown as { merged_existing: boolean }).merged_existing).toBe(true);

    const admin = adminClient();
    // Placeholder row is gone.
    const { data: ph } = await admin.from("group_members").select("id").eq("id", ghostBob.id);
    expect(ph?.length ?? 0).toBe(0);

    // Existing wins: bob's MATCH answer stays "playing" (the guest's "not_playing" dropped).
    const { data: matchRows } = await admin
      .from("availabilities")
      .select("status")
      .eq("match_id", matchId)
      .eq("member_id", bobMemberId);
    expect(matchRows?.length).toBe(1);
    expect(matchRows?.[0].status).toBe("playing");

    // Non-collision re-parents: bob's member now has the PRACTICE answer.
    const { data: practiceRows } = await admin
      .from("availabilities")
      .select("status, user_id")
      .eq("practice_id", practiceId)
      .eq("member_id", bobMemberId);
    expect(practiceRows?.length).toBe(1);
    expect(practiceRows?.[0].status).toBe("maybe");
    expect(practiceRows?.[0].user_id).toBe(bob.id);
  });

  it("anon cannot read group_members or availabilities tables directly (RLS)", async () => {
    const anon = anonClient();
    const { data: members } = await anon.from("group_members").select("id").eq("group_id", groupId);
    expect(members?.length ?? 0).toBe(0);
    const { data: avails } = await anon.from("availabilities").select("id").eq("match_id", matchId);
    expect(avails?.length ?? 0).toBe(0);
  });
});
