"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";

// A user's manual calendar entry. Fields mirror public.personal_events
// (snake_case); the calendar UI converts to its own camelCase shape.
export interface PersonalEvent {
  id: string;
  user_id: string;
  title: string;
  event_date: string; // 'YYYY-MM-DD'
  event_time: string; // 'HH:MM' or ''
  duration_minutes: number | null;
  location: string;
  court_facility_id: string | null;
  notes: string;
  timezone: string;
  created_at: string;
  updated_at: string;
}

const EVENT_COLUMNS =
  "id, user_id, title, event_date, event_time, duration_minutes, location, court_facility_id, notes, timezone, created_at, updated_at";

export async function listMyPersonalEvents(
  supabase: SupabaseClient<Database>
): Promise<PersonalEvent[]> {
  const { data, error } = await supabase
    .from("personal_events")
    .select(EVENT_COLUMNS)
    .order("event_date", { ascending: true })
    .order("event_time", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PersonalEvent[];
}

export type PersonalEventInput = {
  title: string;
  eventDate: string; // 'YYYY-MM-DD'
  eventTime?: string; // 'HH:MM' or ''
  durationMinutes?: number | null;
  location?: string;
  courtFacilityId?: string | null; // catalog "tf-N" or null
  notes?: string;
  timezone?: string;
};

export async function createPersonalEvent(
  supabase: SupabaseClient<Database>,
  input: PersonalEventInput
): Promise<PersonalEvent> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  if (!input.title.trim()) throw new Error("Give your event a title.");
  if (!input.eventDate) throw new Error("Pick a date.");

  const { data, error } = await supabase
    .from("personal_events")
    .insert({
      user_id: auth.user.id,
      title: input.title.trim(),
      event_date: input.eventDate,
      event_time: input.eventTime ?? "",
      duration_minutes: input.durationMinutes ?? null,
      location: input.location?.trim() ?? "",
      court_facility_id: input.courtFacilityId ?? null,
      notes: input.notes?.trim() ?? "",
      timezone: input.timezone ?? "America/Los_Angeles",
    })
    .select(EVENT_COLUMNS)
    .single();
  if (error) throw error;
  return data as PersonalEvent;
}

export async function updatePersonalEvent(
  supabase: SupabaseClient<Database>,
  id: string,
  input: PersonalEventInput
): Promise<PersonalEvent> {
  if (!input.title.trim()) throw new Error("Give your event a title.");
  if (!input.eventDate) throw new Error("Pick a date.");

  const { data, error } = await supabase
    .from("personal_events")
    .update({
      title: input.title.trim(),
      event_date: input.eventDate,
      event_time: input.eventTime ?? "",
      duration_minutes: input.durationMinutes ?? null,
      location: input.location?.trim() ?? "",
      court_facility_id: input.courtFacilityId ?? null,
      notes: input.notes?.trim() ?? "",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(EVENT_COLUMNS)
    .single();
  if (error) throw error;
  return data as PersonalEvent;
}

export async function deletePersonalEvent(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<void> {
  const { error } = await supabase.from("personal_events").delete().eq("id", id);
  if (error) throw error;
}
