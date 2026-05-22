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
  return data as Profile;
}

export async function completeOnboarding(
  supabase: SupabaseClient<Database>,
  patch: ProfileUpdate
): Promise<Profile> {
  return updateMyProfile(supabase, { ...patch, onboarding_complete: true });
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
): Promise<Profile[]> {
  // Exclude the signed-in user from "Discover players" results — seeing
  // yourself in a list of partners to message isn't useful.
  const { data: userData } = await supabase.auth.getUser();
  const myId = userData.user?.id;

  let q = supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("onboarding_complete", true)
    .neq("name", "");
  if (myId) q = q.neq("id", myId);
  if (opts.ntrpMin !== undefined) q = q.gte("ntrp_rating", opts.ntrpMin);
  if (opts.ntrpMax !== undefined) q = q.lte("ntrp_rating", opts.ntrpMax);
  if (opts.gender) q = q.eq("gender", opts.gender);
  if (opts.ageRange) q = q.eq("age_range", opts.ageRange);
  const { data, error } = await q.limit(opts.limit ?? 50);
  if (error) throw error;
  return (data ?? []) as Profile[];
}
