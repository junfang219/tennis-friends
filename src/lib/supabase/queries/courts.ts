"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";

export interface Court {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  notes: string;
  added_by_id: string;
  created_at: string;
}

const COURT_COLUMNS =
  "id, name, latitude, longitude, notes, added_by_id, created_at";

export async function listCourts(
  supabase: SupabaseClient<Database>,
  opts: { limit?: number } = {}
): Promise<Court[]> {
  const { data, error } = await supabase
    .from("courts")
    .select(COURT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 100);
  if (error) throw error;
  return (data ?? []) as Court[];
}

export async function getCourt(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<Court | null> {
  const { data, error } = await supabase
    .from("courts")
    .select(COURT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Court | null) ?? null;
}

export async function addCourt(
  supabase: SupabaseClient<Database>,
  input: { name: string; latitude: number; longitude: number; notes?: string }
): Promise<Court> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("courts")
    .insert({
      ...input,
      notes: input.notes ?? "",
      added_by_id: auth.user.id,
    })
    .select(COURT_COLUMNS)
    .single();
  if (error) throw error;
  return data as Court;
}

export interface CourtReview {
  id: string;
  court_id: string;
  user_id: string;
  stars: number;
  content: string;
  created_at: string;
  updated_at: string;
  user: { id: string; name: string; profile_image_url: string };
  photos: { id: string; url: string; order: number }[];
}

export async function listCourtReviews(
  supabase: SupabaseClient<Database>,
  courtId: string
): Promise<CourtReview[]> {
  const { data, error } = await supabase
    .from("court_reviews")
    .select(
      `id, court_id, user_id, stars, content, created_at, updated_at,
       user:profiles!court_reviews_user_id_fkey ( id, name, profile_image_url ),
       photos:court_review_photos ( id, url, "order" )`
    )
    .eq("court_id", courtId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as CourtReview[];
}

export async function addCourtReview(
  supabase: SupabaseClient<Database>,
  courtId: string,
  input: { stars: number; content: string; photoUrls?: string[] }
): Promise<CourtReview> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");

  // Upsert on (court_id, user_id) — the table has a unique constraint there,
  // so writing a second review for the same court would otherwise hit
  // "duplicate key value violates unique constraint court_reviews_unique".
  // The ReviewComposer is used for both create and edit, so this lets the
  // edit path overwrite the existing row instead of failing.
  const { data: review, error } = await supabase
    .from("court_reviews")
    .upsert(
      {
        court_id: courtId,
        user_id: auth.user.id,
        stars: input.stars,
        content: input.content,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "court_id,user_id" }
    )
    .select("id")
    .single();
  if (error) throw error;

  // Photos: replace the set every save so edits stay consistent with the UI.
  await supabase.from("court_review_photos").delete().eq("review_id", review.id);
  if (input.photoUrls && input.photoUrls.length > 0) {
    const photos = input.photoUrls.map((url, i) => ({
      review_id: review.id,
      url,
      order: i,
    }));
    const { error: phErr } = await supabase.from("court_review_photos").insert(photos);
    if (phErr) throw phErr;
  }

  const fresh = await supabase
    .from("court_reviews")
    .select(
      `id, court_id, user_id, stars, content, created_at, updated_at,
       user:profiles!court_reviews_user_id_fkey ( id, name, profile_image_url ),
       photos:court_review_photos ( id, url, "order" )`
    )
    .eq("id", review.id)
    .single();
  if (fresh.error) throw fresh.error;
  return fresh.data as unknown as CourtReview;
}
