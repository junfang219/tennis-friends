"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Updates } from "../types";

// Manual shape that matches the PROFILE_COLUMNS select. We don't fetch the
// PostGIS location column from the client; backend code that needs it should
// query directly via the admin client.
export interface Profile {
  id: string;
  email: string | null;
  phone: string | null;
  name: string;
  bio: string;
  skill_level: string;
  favorite_surface: string;
  profile_image_url: string;
  cover_image_url: string;
  cover_offset_y: number;
  cover_scale: number;
  custom_tags: string;
  latitude: number | null;
  longitude: number | null;
  gender: string;
  age_range: string;
  rating_system: string;
  ntrp_rating: number | null;
  utr_rating: number | null;
  handle: string | null;
  venmo_handle: string | null;
  paypal_handle: string | null;
  cashapp_handle: string | null;
  zelle_handle: string | null;
  onboarding_complete: boolean;
  is_private: boolean;
  created_at: string;
  updated_at: string;
}

export type ProfileUpdate = Updates<"profiles">;

const PROFILE_COLUMNS =
  "id, email, phone, name, bio, skill_level, favorite_surface, profile_image_url, cover_image_url, cover_offset_y, cover_scale, custom_tags, latitude, longitude, gender, age_range, rating_system, ntrp_rating, utr_rating, handle, venmo_handle, paypal_handle, cashapp_handle, zelle_handle, onboarding_complete, is_private, created_at, updated_at";

// Shared column subset for any join that displays a profile alongside
// their payment handles. Any creditor/debtor view (SplitCostSheet today;
// future league fees, court bookings, etc.) should use this so both
// sides of the join carry the same handle data — preventing a recurrence
// of the bug where one side had handles and the other had hardcoded nulls.
export const PAYMENT_PROFILE_COLUMNS =
  "id, name, profile_image_url, venmo_handle, paypal_handle, cashapp_handle, zelle_handle";

export interface PaymentProfile {
  id: string;
  name: string;
  profile_image_url: string;
  venmo_handle: string | null;
  paypal_handle: string | null;
  cashapp_handle: string | null;
  zelle_handle: string | null;
}

export async function getProfile(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Profile | null) ?? null;
}

export async function getMyProfile(
  supabase: SupabaseClient<Database>
): Promise<Profile | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  return getProfile(supabase, auth.user.id);
}

export async function updateMyProfile(
  supabase: SupabaseClient<Database>,
  patch: ProfileUpdate
): Promise<Profile> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", auth.user.id)
    .select(PROFILE_COLUMNS)
    .single();
  if (error) throw error;
  // Mirror name + avatar into Supabase Auth user_metadata so the
  // useSession compat shim (which reads from user_metadata, not the
  // profiles table) reflects the change. Without this, the navbar +
  // composer keep rendering the signup-time initials/avatar after the
  // user edits their profile. Skip the auth roundtrip when the patch
  // doesn't touch either field — most calls are location-only or tag
  // updates.
  const metadata: { name?: string; avatar_url?: string } = {};
  if (patch.name !== undefined) metadata.name = patch.name ?? "";
  if (patch.profile_image_url !== undefined) {
    metadata.avatar_url = patch.profile_image_url ?? "";
  }
  if (Object.keys(metadata).length > 0) {
    await supabase.auth.updateUser({ data: metadata });
  }
  return data as Profile;
}

export async function completeOnboarding(
  supabase: SupabaseClient<Database>,
  patch: ProfileUpdate
): Promise<Profile> {
  return updateMyProfile(supabase, { ...patch, onboarding_complete: true });
}

// Profile + the viewer's friendship state with that profile. The Discover
// Players page needs the state to render the right button (Add Friend /
// Request Sent / Accept-Decline) for any non-accepted relationship.
// Accepted friends are filtered out entirely — Discover is for finding
// *new* partners, so showing existing friends with no available action is
// noise (and was the bug that motivated this shape).
export interface SearchProfile extends Profile {
  friendshipId: string | null;
  friendshipStatus: "PENDING" | "ACCEPTED" | null;
  isRequester: boolean;
}

export async function searchProfiles(
  supabase: SupabaseClient<Database>,
  opts: {
    ntrpMin?: number;
    ntrpMax?: number;
    gender?: string;
    ageRange?: string;
    limit?: number;
  } = {}
): Promise<SearchProfile[]> {
  // Exclude the signed-in user from "Discover players" results — seeing
  // yourself in a list of partners to message isn't useful.
  const { data: userData } = await supabase.auth.getUser();
  const myId = userData.user?.id;

  // Pull the viewer's friendships once so we can both exclude accepted
  // friends from the result set and annotate any remaining rows
  // (pending outgoing / incoming) with the state the UI button needs.
  // Anonymous viewers have no friendships; skip the query entirely.
  const friendshipByOther = new Map<
    string,
    { id: string; status: "pending" | "accepted"; isRequester: boolean }
  >();
  if (myId) {
    const { data: friendships, error: fErr } = await supabase
      .from("friendships")
      .select("id, requester_id, addressee_id, status")
      .or(`requester_id.eq.${myId},addressee_id.eq.${myId}`);
    if (fErr) throw fErr;
    for (const f of friendships ?? []) {
      const otherId = f.requester_id === myId ? f.addressee_id : f.requester_id;
      friendshipByOther.set(otherId, {
        id: f.id,
        status: f.status as "pending" | "accepted",
        isRequester: f.requester_id === myId,
      });
    }
  }
  const acceptedIds = [...friendshipByOther.entries()]
    .filter(([, f]) => f.status === "accepted")
    .map(([id]) => id);

  let q = supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("onboarding_complete", true)
    .neq("name", "");
  if (myId) q = q.neq("id", myId);
  if (acceptedIds.length > 0) {
    // PostgREST's `in` filter takes a parenthesised comma-separated list.
    q = q.not("id", "in", `(${acceptedIds.join(",")})`);
  }
  if (opts.ntrpMin !== undefined) q = q.gte("ntrp_rating", opts.ntrpMin);
  if (opts.ntrpMax !== undefined) q = q.lte("ntrp_rating", opts.ntrpMax);
  if (opts.gender) q = q.eq("gender", opts.gender);
  if (opts.ageRange) q = q.eq("age_range", opts.ageRange);
  const { data, error } = await q.limit(opts.limit ?? 50);
  if (error) throw error;
  return (data ?? []).map((p) => {
    const f = friendshipByOther.get(p.id);
    return {
      ...(p as Profile),
      friendshipId: f?.id ?? null,
      // Uppercase to match the legacy NextAuth-shape status the UI button
      // already expects (see FriendRequestButton + getFriendshipWith).
      friendshipStatus: f ? (f.status.toUpperCase() as "PENDING" | "ACCEPTED") : null,
      isRequester: f?.isRequester ?? false,
    };
  });
}
