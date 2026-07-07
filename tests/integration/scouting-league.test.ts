import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  adminClient,
  integrationEnvReady,
  makeTestUser,
  deleteTestUsers,
  type TestUser,
} from "./_helpers";
import { upsertOpponentTeam } from "@/lib/tennisrecord/persist";

// League scouting (is_own) — DB-level behavior:
// - at most one own-team row per group (partial unique index)
// - members can read scouted teams incl. is_own; only captains can write
const d = integrationEnvReady ? describe : describe.skip;

d("scouting league (opponent_teams.is_own)", () => {
  let captain: TestUser;
  let member: TestUser;
  let groupId: string;

  beforeAll(async () => {
    captain = await makeTestUser("scout-captain");
    member = await makeTestUser("scout-member");

    const { data: g, error } = await captain.client
      .from("groups")
      .insert({ name: "scout-league-test", owner_id: captain.id })
      .select("id")
      .single();
    if (error || !g) throw new Error(`group insert failed: ${error?.message}`);
    groupId = g.id;
    // groups_auto_add_owner trigger writes the captain's owner row.
    await adminClient()
      .from("group_members")
      .insert([{ group_id: groupId, user_id: member.id, roles: [] }]);
  }, 30000);

  afterAll(async () => {
    if (groupId) await adminClient().from("groups").delete().eq("id", groupId);
    await deleteTestUsers([captain, member]);
  }, 30000);

  it("captain (owner) can save an own-team row; a second own row is rejected", async () => {
    const { data: own, error } = await captain.client
      .from("opponent_teams")
      .insert({
        group_id: groupId,
        name: "For Funzies",
        source_team_key: "teamname=for funzies&year=2026",
        is_own: true,
        created_by_id: captain.id,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(own?.id).toBeTruthy();

    const { error: dupErr } = await captain.client
      .from("opponent_teams")
      .insert({
        group_id: groupId,
        name: "Another Own",
        source_team_key: "teamname=another&year=2026",
        is_own: true,
        created_by_id: captain.id,
      });
    expect(dupErr?.code).toBe("23505"); // opponent_teams_one_own_per_group
  });

  it("opponents coexist with the own row and members can read both", async () => {
    const { error } = await captain.client.from("opponent_teams").insert({
      group_id: groupId,
      name: "Slice Girls",
      source_team_key: "teamname=slice girls&year=2026",
      is_own: false,
      created_by_id: captain.id,
    });
    expect(error).toBeNull();

    const { data: rows, error: readErr } = await member.client
      .from("opponent_teams")
      .select("name, is_own")
      .eq("group_id", groupId)
      .order("is_own", { ascending: false });
    expect(readErr).toBeNull();
    expect(rows?.map((r) => [r.name, r.is_own])).toEqual([
      ["For Funzies", true],
      ["Slice Girls", false],
    ]);
  });

  it("re-importing a DIFFERENT own team replaces the previous one instead of colliding", async () => {
    // Regression: captain imported the wrong team, then re-imports the correct
    // one. Both may share a name; the newest own-team import must take over the
    // single own-team slot rather than hitting opponent_teams_one_own_per_group.
    const { data: g2, error: gErr } = await captain.client
      .from("groups")
      .insert({ name: "scout-replace-test", owner_id: captain.id })
      .select("id")
      .single();
    if (gErr || !g2) throw new Error(`group insert failed: ${gErr?.message}`);
    const gid = g2.id;

    const base = {
      name: "Aces",
      resolvedUrl: "",
      createdById: captain.id,
      isOwn: true as const,
      fetchStatus: "error" as const,
      fetchError: "",
      players: [],
    };
    const first = await upsertOpponentTeam(captain.client, gid, {
      ...base,
      teamKey: "teamname=wrong&year=2026",
    });
    expect("teamId" in first).toBe(true);

    const second = await upsertOpponentTeam(captain.client, gid, {
      ...base,
      teamKey: "teamname=right&year=2026",
    });
    expect("teamId" in second).toBe(true);
    if ("teamId" in second) expect(second.ownReplaced).toBe(true);

    // Exactly one own team, pointing at the most recent (correct) import.
    const { data: owns, error: readErr } = await captain.client
      .from("opponent_teams")
      .select("source_team_key, is_own")
      .eq("group_id", gid)
      .eq("is_own", true);
    expect(readErr).toBeNull();
    expect(owns).toHaveLength(1);
    expect(owns?.[0].source_team_key).toBe("teamname=right&year=2026");

    await adminClient().from("groups").delete().eq("id", gid);
  });

  it("a plain member cannot write opponent_teams", async () => {
    const { error } = await member.client.from("opponent_teams").insert({
      group_id: groupId,
      name: "Sneaky Insert",
      source_team_key: "teamname=sneaky&year=2026",
      created_by_id: member.id,
    });
    expect(error?.code).toBe("42501"); // RLS: captains only
  });
});
