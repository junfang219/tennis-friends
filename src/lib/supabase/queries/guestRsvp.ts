"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";

// ---- Captain-side: create placeholders + manage share links ----

export interface PlaceholderLink {
  id: string;
  name: string;
  token: string;
  expires_at: string | null;
}

/**
 * Bulk-add account-less placeholder roster members by name. Server generates a
 * per-person claim_token (the magic-link credential). Captain-gated by RLS via
 * the add_roster_placeholders RPC. Returns the new rows' ids/names/tokens.
 */
export async function addRosterPlaceholders(
  supabase: SupabaseClient<Database>,
  groupId: string,
  people: { name: string; email?: string; phone?: string }[]
): Promise<PlaceholderLink[]> {
  const { data, error } = await supabase.rpc("add_roster_placeholders", {
    p_group_id: groupId,
    p_people: people as unknown as Database["public"]["Functions"]["add_roster_placeholders"]["Args"]["p_people"],
  });
  if (error) throw error;
  return (data ?? []) as unknown as PlaceholderLink[];
}

/** Per-person share links for every placeholder on the team (captain-only). */
export async function getRosterPlaceholderLinks(
  supabase: SupabaseClient<Database>,
  groupId: string
): Promise<PlaceholderLink[]> {
  const { data, error } = await supabase.rpc("get_roster_placeholder_links", {
    p_group_id: groupId,
  });
  if (error) throw error;
  return (data ?? []) as unknown as PlaceholderLink[];
}

/** Mint (or rotate) the shared self-add roster link; returns the token. */
export async function mintRosterLink(
  supabase: SupabaseClient<Database>,
  groupId: string
): Promise<string> {
  const { data, error } = await supabase.rpc("mint_roster_link", { p_group_id: groupId });
  if (error) throw error;
  return data as unknown as string;
}

/** Revoke the shared self-add roster link. */
export async function revokeRosterLink(
  supabase: SupabaseClient<Database>,
  groupId: string
): Promise<void> {
  const { error } = await supabase.rpc("revoke_roster_link", { p_group_id: groupId });
  if (error) throw error;
}

// ---- Guest-side (anon): view + RSVP via the per-person link ----

export interface GuestEvent {
  id: string;
  event_kind: "match" | "practice";
  date: string;
  time: string;
  location: string;
  opponent?: string;
  notes?: string;
  series_name?: string;
  my_status: string | null;
  counts: { playing: number; maybe: number; not_playing: number };
}

export interface GuestRosterView {
  group: { id: string; name: string; image_url: string };
  member: { id: string; name: string };
  matches: GuestEvent[];
  practices: GuestEvent[];
}

/** Anon: the team name, the guest's name, and the upcoming schedule + counts. */
export async function getGuestRosterView(
  supabase: SupabaseClient<Database>,
  token: string
): Promise<GuestRosterView> {
  const { data, error } = await supabase.rpc("guest_roster_view", { p_token: token });
  if (error) throw error;
  return data as unknown as GuestRosterView;
}

/** Anon: set the guest's RSVP for one event (keyed to their placeholder slot). */
export async function guestSetAvailability(
  supabase: SupabaseClient<Database>,
  args: {
    token: string;
    eventKind: "match" | "practice";
    eventId: string;
    status: string;
    matchTypes?: string;
  }
): Promise<void> {
  const { error } = await supabase.rpc("guest_set_availability", {
    p_token: args.token,
    p_event_kind: args.eventKind,
    p_event_id: args.eventId,
    p_status: args.status,
    p_match_types: args.matchTypes ?? "",
  });
  if (error) throw error;
}

/** Anon: fix the guest's display name (the "wrong name" case). */
export async function guestUpdateName(
  supabase: SupabaseClient<Database>,
  token: string,
  name: string
): Promise<void> {
  const { error } = await supabase.rpc("guest_update_name", { p_token: token, p_name: name });
  if (error) throw error;
}

/** Anon: create a placeholder via the shared self-add link; returns its token. */
export async function guestCreatePlaceholder(
  supabase: SupabaseClient<Database>,
  groupToken: string,
  name: string
): Promise<string> {
  const { data, error } = await supabase.rpc("guest_create_placeholder", {
    p_group_token: groupToken,
    p_name: name,
  });
  if (error) throw error;
  return (data as unknown as { token: string }).token;
}

// ---- Authenticated: claim the placeholder into the signed-in account ----

export interface ClaimResult {
  ok: boolean;
  group_id: string;
  merged_existing: boolean;
}

/** Convert/merge the placeholder addressed by `token` into the current user. */
export async function claimRosterPlaceholder(
  supabase: SupabaseClient<Database>,
  token: string
): Promise<ClaimResult> {
  const { data, error } = await supabase.rpc("claim_roster_placeholder", { p_token: token });
  if (error) throw error;
  return data as unknown as ClaimResult;
}
