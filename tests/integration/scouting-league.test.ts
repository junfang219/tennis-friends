import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  adminClient,
  integrationEnvReady,
  makeTestUser,
  deleteTestUsers,
  type TestUser,
} from "./_helpers";

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
