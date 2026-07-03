"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";

export interface Notification {
  id: string;
  user_id: string;
  // NULL for a guest (accountless) actor — e.g. a guest RSVP to a
  // find_players post. Read actor_guest_name as the display fallback.
  actor_id: string | null;
  type:
    | "comment"
    | "like"
    | "join_request"
    | "request_approved"
    | "request_rejected"
    | "message_reaction"
    | "event_invite"
    | "friend_request"
    | "group_invite_accepted"
    | "availability_poll"
    | "club_invite"
    | "club_invite_accepted"
    | "court_available";
  post_id: string | null;
  comment_id: string | null;
  message_id: string | null;
  // Catalog facility id ("tf-N") a court_available alert deep-links to.
  court_id: string | null;
  // Session-chat / team-chat message a reaction targeted. Used to deep-link a
  // message_reaction notification into the right thread (chat_message → chat,
  // group_message → group). message_id stays for DM reactions.
  chat_message_id: string | null;
  group_message_id: string | null;
  event_id: string | null;
  match_id: string | null;
  poll_id: string | null;
  friend_group_id: string | null;
  emoji: string;
  read: boolean;
  created_at: string;
  // Display name for a profile-less (guest) actor; set when actor_id is NULL.
  actor_guest_name: string | null;
  // NULL when the actor is a guest (no profile row to join).
  actor: {
    id: string;
    name: string;
    profile_image_url: string;
  } | null;
  // Thread ids resolved via the FK joins above, for routing.
  chat_message: { chat_id: string } | null;
  group_message: { group_id: string } | null;
}

const NOTIF_COLUMNS = `
  id, user_id, actor_id, actor_guest_name, type, post_id, comment_id, message_id,
  chat_message_id, group_message_id, event_id,
  match_id, poll_id, friend_group_id, court_id, emoji, read, created_at,
  actor:profiles!notifications_actor_id_fkey ( id, name, profile_image_url ),
  chat_message:chat_messages!notifications_chat_message_id_fkey ( chat_id ),
  group_message:group_messages!notifications_group_message_id_fkey ( group_id )
`;

export async function listNotifications(
  supabase: SupabaseClient<Database>,
  opts: { limit?: number } = {}
): Promise<Notification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select(NOTIF_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 100);
  if (error) throw error;
  return (data ?? []) as unknown as Notification[];
}

// Fetch a single notification by id with the actor profile joined.
// Used by the realtime subscription to hydrate the row from a
// postgres_changes payload (which only carries the bare row columns)
// without re-running the full listNotifications query.
export async function getNotification(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<Notification | null> {
  const { data, error } = await supabase
    .from("notifications")
    .select(NOTIF_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Notification | null) ?? null;
}

export async function unreadNotificationCount(
  supabase: SupabaseClient<Database>
): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("read", false);
  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationRead(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("id", id);
  if (error) throw error;
}

export async function markAllNotificationsRead(
  supabase: SupabaseClient<Database>
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return;
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("user_id", auth.user.id)
    .eq("read", false);
  if (error) throw error;
}

export async function deleteNotification(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
