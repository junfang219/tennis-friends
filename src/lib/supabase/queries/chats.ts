"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";

export interface Chat {
  id: string;
  name: string;
  creator_id: string;
  post_id: string | null;
  friend_group_id: string | null;
  session_end_at: string | null;
  manual_player_names: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  chat_id: string;
  sender_id: string;
  content: string;
  media_url: string;
  media_type: string;
  created_at: string;
  sender: { id: string; name: string; profile_image_url: string };
}

export interface ChatParticipant {
  id: string;
  chat_id: string;
  user_id: string;
  joined_at: string;
  last_read_at: string;
  muted: boolean;
  pinned_at: string | null;
  hidden_at: string | null;
  cleared_at: string | null;
  user: { id: string; name: string; profile_image_url: string };
}

const CHAT_COLS =
  "id, name, creator_id, post_id, friend_group_id, session_end_at, manual_player_names, created_at, updated_at";

export async function listMyChats(supabase: SupabaseClient<Database>): Promise<Chat[]> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data: parts, error: pErr } = await supabase
    .from("chat_participants")
    .select("chat_id")
    .eq("user_id", auth.user.id)
    .is("hidden_at", null);
  if (pErr) throw pErr;
  const chatIds = (parts ?? []).map((p) => p.chat_id);
  if (chatIds.length === 0) return [];
  const { data, error } = await supabase
    .from("chats")
    .select(CHAT_COLS)
    .in("id", chatIds)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Chat[];
}

export async function getChat(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<Chat | null> {
  const { data, error } = await supabase
    .from("chats")
    .select(CHAT_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Chat | null) ?? null;
}

export async function listChatMessages(
  supabase: SupabaseClient<Database>,
  chatId: string,
  opts: { limit?: number } = {}
): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select(
      `id, chat_id, sender_id, content, media_url, media_type, created_at,
       sender:profiles!chat_messages_sender_id_fkey ( id, name, profile_image_url )`
    )
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 100);
  if (error) throw error;
  return ((data ?? []) as unknown as ChatMessage[]).reverse();
}

export async function sendChatMessage(
  supabase: SupabaseClient<Database>,
  chatId: string,
  content: string,
  opts: { mediaUrl?: string; mediaType?: string } = {}
): Promise<ChatMessage> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      chat_id: chatId,
      sender_id: auth.user.id,
      content,
      media_url: opts.mediaUrl ?? "",
      media_type: opts.mediaType ?? "",
    })
    .select(
      `id, chat_id, sender_id, content, media_url, media_type, created_at,
       sender:profiles!chat_messages_sender_id_fkey ( id, name, profile_image_url )`
    )
    .single();
  if (error) throw error;
  return data as unknown as ChatMessage;
}

export async function listChatParticipants(
  supabase: SupabaseClient<Database>,
  chatId: string
): Promise<ChatParticipant[]> {
  const { data, error } = await supabase
    .from("chat_participants")
    .select(
      `id, chat_id, user_id, joined_at, last_read_at, muted, pinned_at, hidden_at, cleared_at,
       user:profiles!chat_participants_user_id_fkey ( id, name, profile_image_url )`
    )
    .eq("chat_id", chatId);
  if (error) throw error;
  return (data ?? []) as unknown as ChatParticipant[];
}

export async function markChatRead(
  supabase: SupabaseClient<Database>,
  chatId: string
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return;
  const { error } = await supabase
    .from("chat_participants")
    .update({ last_read_at: new Date().toISOString() })
    .eq("chat_id", chatId)
    .eq("user_id", auth.user.id);
  if (error) throw error;
}
