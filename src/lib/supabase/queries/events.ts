"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Inserts } from "../types";

export interface EventRow {
  id: string;
  owner_id: string;
  group_id: string | null;
  title: string;
  description: string;
  event_type: string;
  start_date: string;
  end_date: string;
  signup_deadline: string | null;
  is_public_signup: boolean;
  max_participants: number | null;
  ntrp_min: number | null;
  ntrp_max: number | null;
  status: "open" | "closed" | "active" | "completed" | "cancelled";
  venue_name: string;
  venue_address: string;
  visibility: "public" | "group";
  event_lat: number | null;
  event_lng: number | null;
  radius_mi: number | null;
  host_group_id: string | null;
  config: unknown;
  cover_image_url: string;
  season_id: string | null;
  created_at: string;
  updated_at: string;
}

const EVENT_COLUMNS = `
  id, owner_id, group_id, title, description, event_type, start_date,
  end_date, signup_deadline, is_public_signup, max_participants, ntrp_min,
  ntrp_max, status, venue_name, venue_address, visibility, event_lat,
  event_lng, radius_mi, host_group_id, config, cover_image_url, season_id,
  created_at, updated_at
`;

export type EventInsert = Inserts<"events">;

export async function listEvents(
  supabase: SupabaseClient<Database>,
  opts: { upcoming?: boolean; limit?: number } = {}
): Promise<EventRow[]> {
  let q = supabase.from("events").select(EVENT_COLUMNS);
  if (opts.upcoming !== false) {
    q = q.gte("end_date", new Date().toISOString()).neq("status", "cancelled");
  }
  q = q.order("start_date", { ascending: true }).limit(opts.limit ?? 100);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as EventRow[];
}

export async function getEvent(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<EventRow | null> {
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as EventRow | null) ?? null;
}

export async function createEvent(
  supabase: SupabaseClient<Database>,
  input: Omit<EventInsert, "owner_id">
): Promise<EventRow> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("events")
    .insert({ ...input, owner_id: auth.user.id })
    .select(EVENT_COLUMNS)
    .single();
  if (error) throw error;
  return data as EventRow;
}

export interface EventParticipantRow {
  id: string;
  event_id: string;
  user_id: string;
  status: "registered" | "waitlist" | "withdrawn";
  registered_at: string;
  checked_in_at: string | null;
  wins: number;
  losses: number;
  sets_won: number;
  sets_lost: number;
  points: number;
  user: { id: string; name: string; profile_image_url: string; ntrp_rating: number | null };
}

export async function listEventParticipants(
  supabase: SupabaseClient<Database>,
  eventId: string
): Promise<EventParticipantRow[]> {
  const { data, error } = await supabase
    .from("event_participants")
    .select(
      `id, event_id, user_id, status, registered_at, checked_in_at, wins, losses, sets_won, sets_lost, points,
       user:profiles!event_participants_user_id_fkey ( id, name, profile_image_url, ntrp_rating )`
    )
    .eq("event_id", eventId);
  if (error) throw error;
  return (data ?? []) as unknown as EventParticipantRow[];
}

export async function signupForEvent(
  supabase: SupabaseClient<Database>,
  eventId: string
): Promise<EventParticipantRow> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("event_participants")
    .insert({ event_id: eventId, user_id: auth.user.id, status: "registered" })
    .select(
      `id, event_id, user_id, status, registered_at, checked_in_at, wins, losses, sets_won, sets_lost, points,
       user:profiles!event_participants_user_id_fkey ( id, name, profile_image_url, ntrp_rating )`
    )
    .single();
  if (error) throw error;
  return data as unknown as EventParticipantRow;
}

export async function withdrawFromEvent(
  supabase: SupabaseClient<Database>,
  eventId: string
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("event_participants")
    .update({ status: "withdrawn" })
    .eq("event_id", eventId)
    .eq("user_id", auth.user.id);
  if (error) throw error;
}

export interface EventMatchRow {
  id: string;
  event_id: string;
  player1_id: string;
  player2_id: string;
  player3_id: string | null;
  player4_id: string | null;
  round: number | null;
  bracket_slot: string;
  scheduled_at: string | null;
  court_assign: string;
  score: string;
  winner_side: number | null;
  reported_by: string | null;
  confirmed_by: string | null;
  proposed_by: string | null;
  disputed_at: string | null;
  status: "proposed" | "declined" | "scheduled" | "in_progress" | "completed" | "cancelled";
  created_at: string;
}

const MATCH_COLUMNS = `
  id, event_id, player1_id, player2_id, player3_id, player4_id, round,
  bracket_slot, scheduled_at, court_assign, score, winner_side, reported_by,
  confirmed_by, proposed_by, disputed_at, status, created_at
`;

export async function listEventMatches(
  supabase: SupabaseClient<Database>,
  eventId: string
): Promise<EventMatchRow[]> {
  const { data, error } = await supabase
    .from("event_matches")
    .select(MATCH_COLUMNS)
    .eq("event_id", eventId)
    .order("round", { ascending: true });
  if (error) throw error;
  return (data ?? []) as EventMatchRow[];
}
