"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";
import { getMyIdFast } from "./_authFast";

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
  shared_post_id: string | null;
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
  const me = await getMyIdFast(supabase);
  if (!me) return [];
  const { data: parts, error: pErr } = await supabase
    .from("chat_participants")
    .select("chat_id")
    .eq("user_id", me)
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

// Inbox row for a session/game chat — includes the latest message preview,
// unread count, and per-user mute/pin state. Mirrors the shape of TeamThread
// (queries/groups.ts) so the inbox loader can hydrate session and team
// chats with the same lastMessage / unreadCount UI surface.
export interface ChatThread {
  chat: Chat;
  last_message: {
    id: string;
    sender_id: string;
    sender_name: string;
    content: string;
    created_at: string;
  } | null;
  unread_count: number;
  muted: boolean;
  pinned_at: string | null;
}

export async function listMyChatThreads(
  supabase: SupabaseClient<Database>
): Promise<ChatThread[]> {
  const me = await getMyIdFast(supabase);
  if (!me) return [];

  // Per-user inbox state for every chat I haven't hidden.
  const { data: parts, error: pErr } = await supabase
    .from("chat_participants")
    .select("chat_id, last_read_at, muted, pinned_at, cleared_at")
    .eq("user_id", me)
    .is("hidden_at", null);
  if (pErr) throw pErr;
  const partsByChat = new Map<
    string,
    { last_read_at: string | null; muted: boolean; pinned_at: string | null; cleared_at: string | null }
  >();
  for (const p of parts ?? []) {
    partsByChat.set(p.chat_id, {
      last_read_at: p.last_read_at ?? null,
      muted: !!p.muted,
      pinned_at: p.pinned_at ?? null,
      cleared_at: p.cleared_at ?? null,
    });
  }
  const chatIds = [...partsByChat.keys()];
  if (chatIds.length === 0) return [];

  // Chats + recent messages in parallel. Messages are fetched in one batch
  // (500 cap matches listMyTeamThreads) and grouped client-side; takes the
  // first per chat as the latest. For a single user this is a few KB.
  const [chatsRes, msgsRes] = await Promise.all([
    supabase
      .from("chats")
      .select(CHAT_COLS)
      .in("id", chatIds)
      .order("updated_at", { ascending: false }),
    supabase
      .from("chat_messages")
      .select(
        `id, chat_id, sender_id, content, created_at,
         sender:profiles!chat_messages_sender_id_fkey ( id, name )`
      )
      .in("chat_id", chatIds)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  if (chatsRes.error) throw chatsRes.error;
  if (msgsRes.error) throw msgsRes.error;

  type MsgRow = {
    id: string;
    chat_id: string;
    sender_id: string;
    content: string;
    created_at: string;
    sender: { id: string; name: string };
  };
  const byChat = new Map<string, MsgRow[]>();
  for (const m of (msgsRes.data ?? []) as unknown as MsgRow[]) {
    if (!byChat.has(m.chat_id)) byChat.set(m.chat_id, []);
    byChat.get(m.chat_id)!.push(m);
  }

  const threads: ChatThread[] = [];
  for (const chat of (chatsRes.data ?? []) as Chat[]) {
    const state = partsByChat.get(chat.id);
    if (!state) continue;
    // `cleared_at` (per-user "clear conversation") hides anything older from
    // the inbox preview but doesn't delete the underlying rows.
    const clearedAt = state.cleared_at ?? "1970-01-01T00:00:00Z";
    const msgs = (byChat.get(chat.id) ?? [])
      .filter((m) => m.created_at > clearedAt)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const last = msgs[0] ?? null;
    const lastReadAt = state.last_read_at ?? "1970-01-01T00:00:00Z";
    const unread = msgs.filter(
      (msg) => msg.sender_id !== me && msg.created_at > lastReadAt
    ).length;
    threads.push({
      chat,
      last_message: last
        ? {
            id: last.id,
            sender_id: last.sender_id,
            sender_name: last.sender.name,
            content: last.content,
            created_at: last.created_at,
          }
        : null,
      unread_count: unread,
      muted: state.muted,
      pinned_at: state.pinned_at,
    });
  }

  // Newest activity first; empty chats sort to the bottom by chats.updated_at.
  threads.sort((a, b) => {
    const at = a.last_message?.created_at ?? a.chat.updated_at;
    const bt = b.last_message?.created_at ?? b.chat.updated_at;
    return bt.localeCompare(at);
  });

  return threads;
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

export interface ChatGameContext {
  playDate: string;
  playTime: string;
  playTimezone: string;
  playDuration: number | null;
  courtLocation: string;
}

/**
 * Game timing + venue for the find_players post a chat is attached to. Powers
 * the in-chat court-availability prompt (window + court resolution); the chat
 * bundle itself doesn't carry the post's play fields. Returns null when the
 * post isn't a find_players game (e.g. friend-group chats have no post).
 */
export async function getChatGameContext(
  supabase: SupabaseClient<Database>,
  postId: string
): Promise<ChatGameContext | null> {
  const { data, error } = await supabase
    .from("posts")
    .select("play_date, play_time, play_timezone, play_duration, court_location")
    .eq("id", postId)
    .eq("post_type", "find_players")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    playDate: data.play_date ?? "",
    playTime: data.play_time ?? "",
    playTimezone: data.play_timezone ?? "",
    playDuration: data.play_duration ?? null,
    courtLocation: data.court_location ?? "",
  };
}

/**
 * One-shot fetch for the chat thread page. Replaces three separate round
 * trips (getChat + listChatParticipants + listChatMessages) with a single
 * nested PostgREST select, so the thread can paint the header + first
 * page of messages without waiting on 2× extra RTT. Messages come back
 * newest-first from PostgREST and are reversed here to match
 * listChatMessages (ascending = oldest-first for rendering top→bottom).
 */
export interface ChatBundle {
  chat: Chat;
  participants: ChatParticipant[];
  messages: ChatMessage[];
}

export async function getChatBundle(
  supabase: SupabaseClient<Database>,
  chatId: string,
  opts: { messageLimit?: number } = {}
): Promise<ChatBundle | null> {
  const messageLimit = opts.messageLimit ?? 100;
  const { data, error } = await supabase
    .from("chats")
    .select(
      `${CHAT_COLS},
       participants:chat_participants!chat_participants_chat_id_fkey (
         id, chat_id, user_id, joined_at, last_read_at, muted, pinned_at, hidden_at, cleared_at,
         user:profiles!chat_participants_user_id_fkey ( id, name, profile_image_url )
       ),
       messages:chat_messages!chat_messages_chat_id_fkey (
         id, chat_id, sender_id, content, media_url, media_type, shared_post_id, created_at,
         sender:profiles!chat_messages_sender_id_fkey ( id, name, profile_image_url )
       )`
    )
    .eq("id", chatId)
    .order("created_at", { referencedTable: "messages", ascending: false })
    .limit(messageLimit, { referencedTable: "messages" })
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as Chat & {
    participants: ChatParticipant[];
    messages: ChatMessage[];
  };
  const { participants, messages, ...chatFields } = row;

  // Per-user "Clear chat history" soft-clear: hide everything older than
  // the current user's chat_participants.cleared_at. Use the participant
  // row we already fetched — no extra query.
  const me = await getMyIdFast(supabase);
  const myParticipant = me
    ? (participants ?? []).find((p) => p.user_id === me)
    : undefined;
  const clearedAt = myParticipant?.cleared_at ?? null;
  const visibleMessages = clearedAt
    ? (messages ?? []).filter((m) => m.created_at > clearedAt)
    : (messages ?? []);

  return {
    chat: chatFields as Chat,
    participants: participants ?? [],
    messages: visibleMessages.slice().reverse(),
  };
}

export async function listChatMessages(
  supabase: SupabaseClient<Database>,
  chatId: string,
  opts: { limit?: number } = {}
): Promise<ChatMessage[]> {
  const me = await getMyIdFast(supabase);
  // Per-user "Clear chat history" soft-clear via chat_participants.cleared_at.
  // We still let unauthenticated paths fall through (filter is only applied
  // when we can read the participant row), since RLS would block anyway.
  const clearedAt = me ? await readChatClearedAt(supabase, chatId, me) : null;

  let query = supabase
    .from("chat_messages")
    .select(
      `id, chat_id, sender_id, content, media_url, media_type, shared_post_id, created_at,
       sender:profiles!chat_messages_sender_id_fkey ( id, name, profile_image_url )`
    )
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 100);
  if (clearedAt) query = query.gt("created_at", clearedAt);

  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as unknown as ChatMessage[]).reverse();
}

/** Read the current user's per-chat cleared_at (or null if no row). */
async function readChatClearedAt(
  supabase: SupabaseClient<Database>,
  chatId: string,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("chat_participants")
    .select("cleared_at")
    .eq("chat_id", chatId)
    .eq("user_id", userId)
    .maybeSingle();
  return data?.cleared_at ?? null;
}

export async function sendChatMessage(
  supabase: SupabaseClient<Database>,
  chatId: string,
  content: string,
  opts: { mediaUrl?: string; mediaType?: string; expenseId?: string; sharedPostId?: string } = {}
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
      expense_id: opts.expenseId ?? null,
      shared_post_id: opts.sharedPostId ?? null,
    })
    .select(
      `id, chat_id, sender_id, content, media_url, media_type, shared_post_id, created_at,
       sender:profiles!chat_messages_sender_id_fkey ( id, name, profile_image_url )`
    )
    .single();
  if (error) throw error;
  return data as unknown as ChatMessage;
}

/**
 * Rewrite the content of the chat message that was originally posted
 * when an expense was added. No-op if no companion message exists
 * (e.g. the original send failed). RLS: only the sender can update.
 */
export async function updateExpenseChatMessage(
  supabase: SupabaseClient<Database>,
  expenseId: string,
  content: string
): Promise<void> {
  await supabase
    .from("chat_messages")
    .update({ content })
    .eq("expense_id", expenseId);
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
  const me = await getMyIdFast(supabase);
  if (!me) return;
  const { error } = await supabase
    .from("chat_participants")
    .update({ last_read_at: new Date().toISOString() })
    .eq("chat_id", chatId)
    .eq("user_id", me);
  if (error) throw error;
}
