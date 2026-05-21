"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";

export interface Notification {
  id: string;
  user_id: string;
  actor_id: string;
  type:
    | "comment"
    | "like"
    | "join_request"
    | "request_approved"
    | "request_rejected"
    | "message_reaction"
    | "event_invite"
    | "friend_request"
    | "group_invite_accepted";
  post_id: string | null;
  comment_id: string | null;
  message_id: string | null;
  event_id: string | null;
  match_id: string | null;
  emoji: string;
  read: boolean;
  created_at: string;
  actor: {
    id: string;
    name: string;
    profile_image_url: string;
  };
}

const NOTIF_COLUMNS = `
  id, user_id, actor_id, type, post_id, comment_id, message_id, event_id,
  match_id, emoji, read, created_at,
  actor:profiles!notifications_actor_id_fkey ( id, name, profile_image_url )
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
