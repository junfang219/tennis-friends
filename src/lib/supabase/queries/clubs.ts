"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "../types";
import { getMyIdFast } from "./_authFast";

const friendGroupSettingsSchema = z.object({
  name: z.string().trim().min(1, "Enter a group name."),
  membersCanAdd: z.boolean(),
});

export async function updateFriendGroupSettings(
  supabase: SupabaseClient<Database>,
  groupId: string,
  settings: z.input<typeof friendGroupSettingsSchema>
): Promise<void> {
  const { name, membersCanAdd } = friendGroupSettingsSchema.parse(settings);
  const { error } = await supabase.from("friend_groups")
    .update({ name, members_can_add: membersCanAdd })
    .eq("id", z.uuid().parse(groupId))
    .select("id")
    .single();
  if (error) throw error;
}

export interface ClubInvite {
  id: string;
  friend_group_id: string;
  inviter_id: string;
  invitee_id: string;
  status: "pending" | "accepted" | "declined";
  created_at: string;
  updated_at: string;
  club?: { id: string; name: string };
  inviter?: { id: string; name: string; profile_image_url: string };
  invitee?: { id: string; name: string; profile_image_url: string };
}

const INVITE_COLS = "id, friend_group_id, inviter_id, invitee_id, status, created_at, updated_at";

const memberIdsSchema = z.array(z.uuid());

export async function createFriendGroup(
  supabase: SupabaseClient<Database>,
  name: string,
  memberIds: string[],
): Promise<string> {
  const { data, error } = await supabase.rpc("create_friend_group", {
    p_name: z.string().trim().min(1, "Enter a group name.").parse(name),
    p_member_ids: memberIdsSchema.parse(memberIds),
  });
  if (error) throw error;
  return data;
}

export async function addFriendGroupMembers(
  supabase: SupabaseClient<Database>,
  groupId: string,
  memberIds: string[],
): Promise<void> {
  const { error } = await supabase.rpc("add_friend_group_members", {
    p_friend_group_id: z.uuid().parse(groupId),
    p_member_ids: memberIdsSchema.parse(memberIds),
  });
  if (error) throw error;
}

/** Accept (RPC: membership + chat join + inviter notification) or decline. */
export async function respondToClubInvite(
  supabase: SupabaseClient<Database>,
  inviteId: string,
  action: "accept" | "decline"
): Promise<{ friendGroupId: string; chatId: string | null } | null> {
  if (action === "accept") {
    const { data, error } = await supabase.rpc("accept_club_invite", {
      p_invite_id: inviteId,
    });
    if (error) throw error;
    const result = data as { ok: boolean; friend_group_id: string; chat_id?: string } | null;
    if (!result?.ok) throw new Error("Couldn't accept the invite.");
    return { friendGroupId: result.friend_group_id, chatId: result.chat_id ?? null };
  }
  const { error } = await supabase
    .from("friend_group_invites")
    .update({ status: "declined" })
    .eq("id", inviteId);
  if (error) throw error;
  return null;
}

/** Pending invites addressed to me, with club + inviter for the requests UI. */
export async function listIncomingClubInvites(
  supabase: SupabaseClient<Database>
): Promise<ClubInvite[]> {
  const me = await getMyIdFast(supabase);
  if (!me) return [];
  const { data, error } = await supabase
    .from("friend_group_invites")
    .select(
      `${INVITE_COLS},
       club:friend_groups!friend_group_invites_friend_group_id_fkey ( id, name ),
       inviter:profiles!friend_group_invites_inviter_id_fkey ( id, name, profile_image_url )`
    )
    .eq("invitee_id", me)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ClubInvite[];
}

/** Leave the group. The database removes the linked chat seat. */
export async function leaveClub(
  supabase: SupabaseClient<Database>,
  clubId: string
): Promise<void> {
  const me = await getMyIdFast(supabase);
  if (!me) throw new Error("Not signed in");
  await removeClubMember(supabase, clubId, me);
}

/** Members may leave, and the owner may remove another member. */
export async function removeClubMember(
  supabase: SupabaseClient<Database>,
  clubId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from("friend_group_members")
    .delete()
    .eq("friend_group_id", clubId)
    .eq("user_id", userId)
    .select("id")
    .single();
  if (error) throw error;
}

/** The group deletion cascades to its chat and invitations. */
export async function deleteClub(
  supabase: SupabaseClient<Database>,
  clubId: string
): Promise<void> {
  const { error } = await supabase.from("friend_groups").delete().eq("id", clubId).select("id").single();
  if (error) throw error;
}

/** Find the group's private chat. */
export async function getClubChatId(
  supabase: SupabaseClient<Database>,
  clubId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("chats")
    .select("id")
    .eq("friend_group_id", clubId)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}
