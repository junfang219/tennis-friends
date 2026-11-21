import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leaveClub } from "@/lib/supabase/queries";
import {
  adminClient,
  befriend,
  deleteTestUsers,
  integrationEnvReady,
  makeTestUser,
  type TestUser,
} from "./_helpers";

describe.skipIf(!integrationEnvReady)("Private friend groups (Supabase)", () => {
  let owner: TestUser;
  let member: TestUser;
  let theirFriend: TestUser;
  let outsider: TestUser;
  let groupId: string;
  let chatId: string;

  beforeAll(async () => {
    [owner, member, theirFriend, outsider] = await Promise.all([
      makeTestUser("fg-owner"),
      makeTestUser("fg-member"),
      makeTestUser("fg-friend"),
      makeTestUser("fg-outsider"),
    ]);
    await befriend(owner, member);
    await befriend(member, theirFriend);
    const { data, error } = await owner.client.rpc("create_friend_group", {
      p_name: "Weekend Hitters",
      p_member_ids: [member.id],
    });
    expect(error).toBeNull();
    groupId = data!;
    const { data: chat, error: chatError } = await owner.client.from("chats")
      .select("id").eq("friend_group_id", groupId).single();
    expect(chatError).toBeNull();
    chatId = chat!.id;
  }, 60_000);

  afterAll(async () => {
    await deleteTestUsers([owner, member, theirFriend, outsider].filter(Boolean));
  }, 60_000);

  it("adds selected friends to the group and chat at creation and notifies them", async () => {
    const [group, roster, chat, notices] = await Promise.all([
      member.client.from("friend_groups").select("members_can_add").eq("id", groupId).single(),
      owner.client.from("friend_group_members").select("user_id").eq("friend_group_id", groupId),
      member.client.from("chats").select("id").eq("id", chatId).single(),
      member.client.from("notifications").select("actor_id").eq("friend_group_id", groupId)
        .eq("type", "friend_group_added"),
    ]);
    expect(group.data?.members_can_add).toBe(false);
    expect(roster.data?.map(({ user_id }) => user_id).sort()).toEqual([owner.id, member.id].sort());
    expect(chat.data?.id).toBe(chatId);
    expect(notices.data).toEqual([{ actor_id: owner.id }]);
  });

  it("keeps the group private and blocks direct table writes", async () => {
    const [group, chat, memberInsert, chatInsert, add] = await Promise.all([
      outsider.client.from("friend_groups").select("id").eq("id", groupId),
      outsider.client.from("chats").select("id").eq("id", chatId),
      owner.client.from("friend_group_members").insert({ friend_group_id: groupId, user_id: outsider.id }),
      owner.client.from("chat_participants").insert({ chat_id: chatId, user_id: outsider.id }),
      outsider.client.rpc("add_friend_group_members", { p_friend_group_id: groupId, p_member_ids: [outsider.id] }),
    ]);
    expect(group.data).toEqual([]);
    expect(chat.data).toEqual([]);
    expect(memberInsert.error?.code).toBe("42501");
    expect(chatInsert.error?.code).toBe("42501");
    expect(add.error?.code).toBe("42501");
  });

  it("lets only the owner enable member adds", async () => {
    const params = { p_friend_group_id: groupId, p_member_ids: [theirFriend.id] };
    const { error: denied } = await member.client.rpc("add_friend_group_members", params);
    expect(denied?.code).toBe("42501");
    const { data: memberWrite } = await member.client.from("friend_groups")
      .update({ members_can_add: true }).eq("id", groupId).select("id");
    expect(memberWrite).toEqual([]);
    const { data, error } = await owner.client.from("friend_groups")
      .update({ members_can_add: true }).eq("id", groupId).select("members_can_add").single();
    expect(error).toBeNull();
    expect(data?.members_can_add).toBe(true);
  });

  it("adds only the caller's own friends as an atomic batch", async () => {
    const { error } = await member.client.rpc("add_friend_group_members", {
      p_friend_group_id: groupId, p_member_ids: [theirFriend.id, outsider.id],
    });
    expect(error?.code).toBe("42501");
    const { data } = await adminClient().from("friend_group_members")
      .select("id").eq("friend_group_id", groupId).eq("user_id", theirFriend.id);
    expect(data).toEqual([]);
  });

  it("adds a delegated member's friend instantly and sends one notice on retry", async () => {
    const params = { p_friend_group_id: groupId, p_member_ids: [theirFriend.id, theirFriend.id] };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { error } = await member.client.rpc("add_friend_group_members", params);
      expect(error).toBeNull();
    }
    const [chat, notices] = await Promise.all([
      theirFriend.client.from("chats").select("id").eq("id", chatId).single(),
      theirFriend.client.from("notifications").select("actor_id").eq("friend_group_id", groupId)
        .eq("type", "friend_group_added"),
    ]);
    expect(chat.data?.id).toBe(chatId);
    expect(notices.data).toEqual([{ actor_id: member.id }]);
  });

  it("honors an owner's change and removes chat access when a member leaves", async () => {
    await leaveClub(theirFriend.client, groupId);
    const { error: saveError } = await owner.client.from("friend_groups")
      .update({ members_can_add: false }).eq("id", groupId).select("id").single();
    expect(saveError).toBeNull();
    const { error } = await member.client.rpc("add_friend_group_members", {
      p_friend_group_id: groupId, p_member_ids: [theirFriend.id],
    });
    expect(error?.code).toBe("42501");
    const { data: chat } = await theirFriend.client.from("chats").select("id").eq("id", chatId);
    expect(chat).toEqual([]);
  });
});
