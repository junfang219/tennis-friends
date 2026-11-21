import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  befriend,
  deleteTestUsers,
  integrationEnvReady,
  makeTestUser,
  type TestUser,
} from "./_helpers";

describe.skipIf(!integrationEnvReady)("Legacy friend group invitations (Supabase)", () => {
  let owner: TestUser;
  let friend: TestUser;
  let groupId: string;

  beforeAll(async () => {
    [owner, friend] = await Promise.all([makeTestUser("fg-legacy-owner"), makeTestUser("fg-legacy-friend")]);
    await befriend(owner, friend);
    const { data, error } = await owner.client.rpc("create_friend_group", { p_name: "Legacy group" });
    expect(error).toBeNull();
    groupId = data!;
  }, 60_000);

  afterAll(async () => {
    await deleteTestUsers([owner, friend].filter(Boolean));
  }, 60_000);

  it("allows existing personal invitations to be accepted by the intended recipient", async () => {
    const { data: invite, error: seedError } = await adminClient().from("friend_group_invites")
      .insert({ friend_group_id: groupId, inviter_id: owner.id, invitee_id: friend.id })
      .select("id").single();
    expect(seedError).toBeNull();
    const { error } = await friend.client.rpc("accept_club_invite", { p_invite_id: invite!.id });
    expect(error).toBeNull();
    const { data: group } = await friend.client.from("friend_groups").select("id").eq("id", groupId).single();
    expect(group?.id).toBe(groupId);
  });

  it("keeps stored legacy shared links inaccessible to members", async () => {
    const { error } = await adminClient().from("friend_group_invite_links").insert({
      friend_group_id: groupId, created_by_id: owner.id, token: crypto.randomUUID(),
    });
    expect(error).toBeNull();
    const { data } = await owner.client.from("friend_group_invite_links")
      .select("id").eq("friend_group_id", groupId);
    expect(data).toEqual([]);
  });
});
