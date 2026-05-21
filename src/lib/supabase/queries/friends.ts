"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";
import type { Profile } from "./profiles";

export interface FriendshipRow {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
  updated_at: string;
}

const FRIEND_PROFILE_COLUMNS =
  "id, name, profile_image_url, skill_level, ntrp_rating, utr_rating, rating_system, gender, age_range, latitude, longitude";

export interface FriendProfile {
  id: string;
  name: string;
  profile_image_url: string;
  skill_level: string;
  ntrp_rating: number | null;
  utr_rating: number | null;
  rating_system: string;
  gender: string;
  age_range: string;
  latitude: number | null;
  longitude: number | null;
}

/** All accepted friends of the signed-in user. */
export async function listFriends(
  supabase: SupabaseClient<Database>
): Promise<FriendProfile[]> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const me = auth.user.id;
  const { data, error } = await supabase
    .from("friendships")
    .select(
      `requester_id, addressee_id,
       requester:profiles!friendships_requester_id_fkey ( ${FRIEND_PROFILE_COLUMNS} ),
       addressee:profiles!friendships_addressee_id_fkey ( ${FRIEND_PROFILE_COLUMNS} )`
    )
    .eq("status", "accepted");
  if (error) throw error;
  return (data ?? [])
    .map((row) => {
      const r = row as unknown as {
        requester_id: string;
        addressee_id: string;
        requester: FriendProfile;
        addressee: FriendProfile;
      };
      return r.requester_id === me ? r.addressee : r.requester;
    })
    .filter(Boolean);
}

export interface PendingRequest {
  id: string;
  created_at: string;
  other: FriendProfile;
  direction: "incoming" | "outgoing";
}

export async function listPendingRequests(
  supabase: SupabaseClient<Database>
): Promise<PendingRequest[]> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const me = auth.user.id;
  const { data, error } = await supabase
    .from("friendships")
    .select(
      `id, requester_id, addressee_id, created_at,
       requester:profiles!friendships_requester_id_fkey ( ${FRIEND_PROFILE_COLUMNS} ),
       addressee:profiles!friendships_addressee_id_fkey ( ${FRIEND_PROFILE_COLUMNS} )`
    )
    .eq("status", "pending");
  if (error) throw error;
  return (data ?? []).map((row) => {
    const r = row as unknown as {
      id: string;
      requester_id: string;
      addressee_id: string;
      created_at: string;
      requester: FriendProfile;
      addressee: FriendProfile;
    };
    const incoming = r.addressee_id === me;
    return {
      id: r.id,
      created_at: r.created_at,
      other: incoming ? r.requester : r.addressee,
      direction: incoming ? "incoming" : "outgoing",
    };
  });
}

export async function sendFriendRequest(
  supabase: SupabaseClient<Database>,
  addresseeId: string
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { error } = await supabase.from("friendships").insert({
    requester_id: auth.user.id,
    addressee_id: addresseeId,
    status: "pending",
  });
  if (error) throw error;
}

export async function acceptFriendRequest(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from("friendships")
    .update({ status: "accepted" })
    .eq("id", id);
  if (error) throw error;
}

export async function rejectFriendRequest(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<void> {
  const { error } = await supabase.from("friendships").delete().eq("id", id);
  if (error) throw error;
}

/** Symmetric — remove a friend or withdraw a pending outgoing request. */
export async function removeFriend(
  supabase: SupabaseClient<Database>,
  otherId: string
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const me = auth.user.id;
  const { error } = await supabase
    .from("friendships")
    .delete()
    .or(
      `and(requester_id.eq.${me},addressee_id.eq.${otherId}),and(requester_id.eq.${otherId},addressee_id.eq.${me})`
    );
  if (error) throw error;
}

export async function blockUser(
  supabase: SupabaseClient<Database>,
  blockedId: string
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("blocks")
    .insert({ blocker_id: auth.user.id, blocked_id: blockedId });
  if (error && !error.message.includes("duplicate")) throw error;
}

export async function unblockUser(
  supabase: SupabaseClient<Database>,
  blockedId: string
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("blocks")
    .delete()
    .eq("blocker_id", auth.user.id)
    .eq("blocked_id", blockedId);
  if (error) throw error;
}

// Re-export Profile so callers that already use friends queries get the type.
export type { Profile };
