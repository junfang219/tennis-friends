"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";

// One saved court reservation. Fields mirror public.court_bookings
// (snake_case); UI converts to its own shape as needed.
export interface CourtBooking {
  id: string;
  user_id: string;
  facility_id: string | null; // catalog facility id "tf-N", null if unresolvable
  venue_name: string;
  court_name: string;
  center_id: number;
  resource_id: number;
  start_time: string; // ISO timestamptz
  end_time: string;
  timezone: string;
  status: "confirmed" | "cancelled";
  confirmation: "detected" | "manual";
  receipt_number: string | null;
  activenet_url: string;
  session_post_id: string | null;
  created_at: string;
}

const BOOKING_COLUMNS =
  "id, user_id, facility_id, venue_name, court_name, center_id, resource_id, start_time, end_time, timezone, status, confirmation, receipt_number, activenet_url, session_post_id, created_at";

/** All of the signed-in user's bookings, newest start time first (RLS scopes to owner). */
export async function listMyBookings(
  supabase: SupabaseClient<Database>
): Promise<CourtBooking[]> {
  const { data, error } = await supabase
    .from("court_bookings")
    .select(BOOKING_COLUMNS)
    .order("start_time", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CourtBooking[];
}

/**
 * Mark a booking cancelled on our side. The actual reservation lives on
 * Seattle Parks — cancelling there is the user's separate step.
 */
export async function markBookingCancelled(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from("court_bookings")
    .update({ status: "cancelled" })
    .eq("id", id);
  if (error) throw error;
}

/** Link the find_players post spawned from this booking. */
export async function linkBookingSession(
  supabase: SupabaseClient<Database>,
  id: string,
  postId: string
): Promise<void> {
  const { error } = await supabase
    .from("court_bookings")
    .update({ session_post_id: postId })
    .eq("id", id);
  if (error) throw error;
}
