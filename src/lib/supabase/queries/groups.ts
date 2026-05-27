"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";

export interface Group {
  id: string;
  name: string;
  image_url: string;
  cover_image_url: string;
  cover_offset_y: number;
  cover_scale: number;
  owner_id: string;
  member_types: unknown;
  reminder_prefs: unknown;
  created_at: string;
  updated_at: string;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  role: "owner" | "manager" | "captain" | "member";
  member_type: string;
  created_at: string;
  last_read_at: string;
  muted: boolean;
  pinned_at: string | null;
  hidden_at: string | null;
  cleared_at: string | null;
  archived_at: string | null;
  user: {
    id: string;
    name: string;
    profile_image_url: string;
    ntrp_rating: number | null;
  };
}

const GROUP_COLUMNS =
  "id, name, image_url, cover_image_url, cover_offset_y, cover_scale, owner_id, member_types, reminder_prefs, created_at, updated_at";

/**
 * Groups the signed-in user belongs to (any role). The default
 * filter excludes rows the caller has archived (group_members.
 * archived_at NOT NULL); pass `{ archived: true }` to fetch only
 * the archived list for the Archived Teams collapsible.
 */
export async function listMyGroups(
  supabase: SupabaseClient<Database>,
  opts: { archived?: boolean } = {}
): Promise<Group[]> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];

  let q = supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", auth.user.id);
  q = opts.archived ? q.not("archived_at", "is", null) : q.is("archived_at", null);
  const { data: memberships, error: mErr } = await q;
  if (mErr) throw mErr;
  const groupIds = (memberships ?? []).map((m) => m.group_id);
  if (groupIds.length === 0) return [];

  const { data, error } = await supabase
    .from("groups")
    .select(GROUP_COLUMNS)
    .in("id", groupIds)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Group[];
}

export async function getGroup(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<Group | null> {
  const { data, error } = await supabase
    .from("groups")
    .select(GROUP_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Group | null) ?? null;
}

export async function listGroupMembers(
  supabase: SupabaseClient<Database>,
  groupId: string
): Promise<GroupMember[]> {
  const { data, error } = await supabase
    .from("group_members")
    .select(
      `id, group_id, user_id, role, member_type, created_at, last_read_at, muted, pinned_at, hidden_at, cleared_at, archived_at,
       user:profiles!group_members_user_id_fkey ( id, name, profile_image_url, ntrp_rating )`
    )
    .eq("group_id", groupId)
    .is("archived_at", null);
  if (error) throw error;
  return (data ?? []) as unknown as GroupMember[];
}

export interface GroupMessage {
  id: string;
  group_id: string;
  sender_id: string;
  content: string;
  media_url: string;
  media_type: string;
  shared_post_id: string | null;
  kind: "chat" | "announcement";
  notify_email: boolean;
  pinned_at: string | null;
  poll_id: string | null;
  created_at: string;
  sender: { id: string; name: string; profile_image_url: string };
}

const GROUP_MESSAGE_COLUMNS = `
  id, group_id, sender_id, content, media_url, media_type, shared_post_id,
  kind, notify_email, pinned_at, poll_id, created_at,
  sender:profiles!group_messages_sender_id_fkey ( id, name, profile_image_url )
`;

export async function listGroupMessages(
  supabase: SupabaseClient<Database>,
  groupId: string,
  opts: { limit?: number } = {}
): Promise<GroupMessage[]> {
  const { data, error } = await supabase
    .from("group_messages")
    .select(GROUP_MESSAGE_COLUMNS)
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 100);
  if (error) throw error;
  return (data ?? []).reverse() as unknown as GroupMessage[];
}

export async function sendGroupMessage(
  supabase: SupabaseClient<Database>,
  groupId: string,
  content: string,
  opts: { mediaUrl?: string; mediaType?: string; kind?: "chat" | "announcement" } = {}
): Promise<GroupMessage> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("group_messages")
    .insert({
      group_id: groupId,
      sender_id: auth.user.id,
      content,
      media_url: opts.mediaUrl ?? "",
      media_type: opts.mediaType ?? "",
      kind: opts.kind ?? "chat",
    })
    .select(GROUP_MESSAGE_COLUMNS)
    .single();
  if (error) throw error;
  return data as unknown as GroupMessage;
}
