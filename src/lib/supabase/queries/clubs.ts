"use client";

/**
 * Clubs — invite-grown friend groups (friend_groups.kind = 'club').
 *
 * Unlike Circles (owner-curated lists of the owner's friends), a Club is
 * joined by invitation: any member can invite their OWN accepted friends,
 * the invitee gets a club_invite notification (+ push via the
 * friend_group_invites triggers), and accepting (accept_club_invite RPC)
 * adds them as a member and joins them to the club's chat. Post targeting
 * reuses the friend_group plumbing (post_targets / can_see_post).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";
import { getMyIdFast } from "./_authFast";
import type { FriendGroup } from "./misc";

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

/** Create a club + its chat and send the initial invites (own friends only). */
export async function createClub(
  supabase: SupabaseClient<Database>,
  name: string,
  inviteeIds: string[] = []
): Promise<{ clubId: string; chatId: string }> {
  const { data, error } = await supabase.rpc("create_club", {
    p_name: name,
    p_invitee_ids: inviteeIds,
  });
  if (error) throw new Error(error.message);
  const result = data as { club_id: string; chat_id: string } | null;
  if (!result?.club_id) throw new Error("Couldn't create the club.");
  return { clubId: result.club_id, chatId: result.chat_id };
}

/** Clubs I belong to (member-based, not owner-based — clubs outlive the
 *  creator's friend graph). */
export async function listMyClubs(
  supabase: SupabaseClient<Database>
): Promise<FriendGroup[]> {
  const me = await getMyIdFast(supabase);
  if (!me) return [];
  const { data, error } = await supabase
    .from("friend_groups")
    .select("id, name, owner_id, kind, created_at, updated_at, friend_group_members!inner(user_id)")
    .eq("kind", "club")
    .eq("friend_group_members.user_id", me)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const { friend_group_members, ...g } = row;
    void friend_group_members; // inner-join filter only; not part of the result
    return g;
  }) as FriendGroup[];
}

/**
 * Invite a friend to a club. Mirrors the requestToJoin re-apply pattern:
 * a declined invite is flipped back to pending (the notify_resend trigger
 * re-notifies); pending/accepted rows are returned as-is rather than
 * blindly upserted.
 */
export async function inviteToClub(
  supabase: SupabaseClient<Database>,
  clubId: string,
  inviteeId: string
): Promise<ClubInvite> {
  const me = await getMyIdFast(supabase);
  if (!me) throw new Error("Not signed in");

  const { data: existing, error: readErr } = await supabase
    .from("friend_group_invites")
    .select(INVITE_COLS)
    .eq("friend_group_id", clubId)
    .eq("invitee_id", inviteeId)
    .maybeSingle();
  if (readErr) throw readErr;

  if (existing) {
    if (existing.status !== "declined") return existing as ClubInvite;
    const { data, error } = await supabase
      .from("friend_group_invites")
      .update({ status: "pending" })
      .eq("id", existing.id)
      .select(INVITE_COLS)
      .single();
    if (error) throw error;
    return data as ClubInvite;
  }

  const { data, error } = await supabase
    .from("friend_group_invites")
    .insert({ friend_group_id: clubId, inviter_id: me, invitee_id: inviteeId })
    .select(INVITE_COLS)
    .single();
  if (error) throw error;
  return data as ClubInvite;
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
    if (error) throw new Error(error.message);
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

/** Pending invitees of a club — drives the invite-picker exclusion list
 *  and the "invited" chips on the club card. */
export async function listPendingClubInvitees(
  supabase: SupabaseClient<Database>,
  clubId: string
): Promise<ClubInvite[]> {
  const { data, error } = await supabase
    .from("friend_group_invites")
    .select(
      `${INVITE_COLS},
       invitee:profiles!friend_group_invites_invitee_id_fkey ( id, name, profile_image_url )`
    )
    .eq("friend_group_id", clubId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ClubInvite[];
}

/** Leave a club: drop my membership and my seat in the club chat. */
export async function leaveClub(
  supabase: SupabaseClient<Database>,
  clubId: string
): Promise<void> {
  const me = await getMyIdFast(supabase);
  if (!me) throw new Error("Not signed in");
  const { data: chat } = await supabase
    .from("chats")
    .select("id")
    .eq("friend_group_id", clubId)
    .maybeSingle();
  if (chat) {
    await supabase.from("chat_participants").delete().eq("chat_id", chat.id).eq("user_id", me);
  }
  const { error } = await supabase
    .from("friend_group_members")
    .delete()
    .eq("friend_group_id", clubId)
    .eq("user_id", me);
  if (error) throw error;
}

/** Remove another member from a club: drop their membership and their seat in
 *  the club chat. Mirrors {@link leaveClub} but targets a specific user — RLS
 *  only lets this through for the club owner (friend_group_members) and the chat
 *  creator (chat_participants), which for a club is the same person. */
export async function removeClubMember(
  supabase: SupabaseClient<Database>,
  clubId: string,
  userId: string
): Promise<void> {
  const { data: chat } = await supabase
    .from("chats")
    .select("id")
    .eq("friend_group_id", clubId)
    .maybeSingle();
  if (chat) {
    await supabase
      .from("chat_participants")
      .delete()
      .eq("chat_id", chat.id)
      .eq("user_id", userId);
  }
  const { error } = await supabase
    .from("friend_group_members")
    .delete()
    .eq("friend_group_id", clubId)
    .eq("user_id", userId);
  if (error) throw error;
}

/** Owner-only. Deleting the friend_groups row cascade-deletes the backing chat
 *  (chats.friend_group_id is ON DELETE CASCADE), but we delete the chat first
 *  anyway so the operation is explicit and order-independent. */
export async function deleteClub(
  supabase: SupabaseClient<Database>,
  clubId: string
): Promise<void> {
  const { data: chat } = await supabase
    .from("chats")
    .select("id")
    .eq("friend_group_id", clubId)
    .maybeSingle();
  if (chat) {
    const { error: chatErr } = await supabase.from("chats").delete().eq("id", chat.id);
    if (chatErr) throw chatErr;
  }
  const { error } = await supabase.from("friend_groups").delete().eq("id", clubId);
  if (error) throw error;
}

/**
 * Fetch-or-create the club's stable, reusable QR invite link. Any member can
 * call this (the SECURITY DEFINER RPC gates on club membership), and it's
 * idempotent — repeat calls return the same token, so the QR is stable. The
 * token feeds /club-invite/<token>, which a non-user can scan to sign up and
 * land in the club chat.
 */
export async function getOrCreateClubInviteLink(
  supabase: SupabaseClient<Database>,
  clubId: string
): Promise<{ token: string; clubName: string; friendGroupId: string; isOwner: boolean; expiresAt: string | null }> {
  const { data, error } = await supabase.rpc("get_or_create_club_invite_link", {
    p_friend_group_id: clubId,
  });
  if (error) throw new Error(error.message);
  const result = data as {
    token?: string;
    club_name?: string;
    friend_group_id?: string;
    is_owner?: boolean;
    expires_at?: string;
  } | null;
  if (!result?.token) throw new Error("Couldn't create the invite link.");
  return {
    token: result.token,
    clubName: result.club_name ?? "",
    friendGroupId: result.friend_group_id ?? clubId,
    isOwner: !!result.is_owner,
    expiresAt: result.expires_at ?? null,
  };
}

/** Owner-only. Reset the club's QR link to a fresh token, immediately
 *  invalidating the old QR everywhere. Returns the new token + expiry. */
export async function rotateClubInviteLink(
  supabase: SupabaseClient<Database>,
  clubId: string
): Promise<{ token: string; expiresAt: string | null }> {
  const { data, error } = await supabase.rpc("rotate_club_invite_link", {
    p_friend_group_id: clubId,
  });
  if (error) throw new Error(error.message);
  const result = data as { token?: string; expires_at?: string } | null;
  if (!result?.token) throw new Error("Couldn't reset the invite link.");
  return { token: result.token, expiresAt: result.expires_at ?? null };
}

/** Public preview of a club invite link (club + inviter name) for the
 *  /club-invite landing page — callable before the visitor signs in.
 *  `expired` lets the page short-circuit before account creation. */
export async function getClubInviteLink(
  supabase: SupabaseClient<Database>,
  token: string
): Promise<{ friendGroupId: string; clubName: string; inviterName: string; expired: boolean } | null> {
  const { data, error } = await supabase.rpc("get_club_invite_link", { p_token: token });
  if (error) throw new Error(error.message);
  const result = data as {
    friend_group_id?: string;
    club_name?: string;
    inviter_name?: string;
    expired?: boolean;
  } | null;
  if (!result?.friend_group_id) return null;
  return {
    friendGroupId: result.friend_group_id,
    clubName: result.club_name ?? "",
    inviterName: result.inviter_name ?? "",
    expired: !!result.expired,
  };
}

/** Redeem a club invite link for the signed-in user: join the club + its chat.
 *  Reusable — not consumed. Returns the chat id to deep-link into. */
export async function acceptClubInviteLink(
  supabase: SupabaseClient<Database>,
  token: string
): Promise<{ friendGroupId: string; chatId: string | null }> {
  const { data, error } = await supabase.rpc("accept_club_invite_link", { p_token: token });
  if (error) throw new Error(error.message);
  const result = data as { ok: boolean; friend_group_id: string; chat_id?: string } | null;
  if (!result?.ok) throw new Error("Couldn't accept the invite.");
  return { friendGroupId: result.friend_group_id, chatId: result.chat_id ?? null };
}

/** The club's backing chat id (created with the club in create_club). */
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
