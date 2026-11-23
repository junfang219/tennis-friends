// Shared fetcher for the conversations inbox.
//
// Messages, Friends, and the native unread badge use the same inbox shape.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./supabase/types";
import type { InboxItem } from "@/components/ConversationRow";
import {
  listDmThreads,
  listMyChatThreads,
  listMyTeamThreads,
} from "./supabase/queries";
import { pgToIso } from "./pgDate";

export function inboxCacheKey(userId: string | undefined) {
  return userId ? `chat:inbox:${userId}` : null;
}

const pendingInboxes = new Map<string, Promise<InboxItem[]>>();

export function loadInbox(
  supabase: SupabaseClient<Database>,
  userId: string | undefined,
): Promise<InboxItem[]> {
  if (!userId) return Promise.resolve([]);
  const pending = pendingInboxes.get(userId);
  if (pending) return pending;

  const request = fetchInbox(supabase, userId).finally(() => pendingInboxes.delete(userId));
  pendingInboxes.set(userId, request);
  return request;
}

async function fetchInbox(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<InboxItem[]> {
  const [dms, chats, teams] = await Promise.all([
    listDmThreads(supabase),
    listMyChatThreads(supabase),
    listMyTeamThreads(supabase),
  ]);

  const dmItems: InboxItem[] = dms.map((t) => ({
    type: "direct",
    id: t.other.id,
    title: t.other.name,
    href: `/chat/${t.other.id}`,
    unreadCount: t.unread_count,
    muted: false,
    pinnedAt: null,
    avatarUser: {
      id: t.other.id,
      name: t.other.name,
      profileImageUrl: t.other.profile_image_url,
    },
    lastMessage: {
      content: t.last_message.content,
      // pgToIso so iOS Safari's strict Date parser accepts the "+00" form.
      createdAt: pgToIso(t.last_message.created_at),
      fromSelf: t.last_message.sender_id !== t.other.id,
    },
  }));

  const chatItems: InboxItem[] = chats.map((t) => ({
    type: "group" as const,
    id: t.chat.id,
    title: t.chat.name || (t.chat.friend_group_id ? "Friend group chat" : "Session chat"),
    href: `/chat/group/${t.chat.id}`,
    unreadCount: t.unread_count,
    muted: t.muted,
    pinnedAt: t.pinned_at,
    kind: t.chat.friend_group_id ? "friendGroup" : "session",
    sessionEndAt: t.chat.session_end_at,
    lastMessage: t.last_message
      ? {
          content: t.last_message.content,
          createdAt: pgToIso(t.last_message.created_at),
          fromSelf: t.last_message.sender_id === userId,
          senderName: t.last_message.sender_name,
        }
      : null,
    participants: [],
  }));

  const teamItems: InboxItem[] = teams.map((t) => ({
    type: "team" as const,
    id: t.group.id,
    title: t.group.name,
    href: `/groups/${t.group.id}/chat`,
    unreadCount: t.unread_count,
    muted: t.muted,
    pinnedAt: t.pinned_at,
    imageUrl: t.group.image_url || undefined,
    eventId: t.event_id,
    participants: [],
    lastMessage: t.last_message
      ? {
          content: t.last_message.content,
          createdAt: pgToIso(t.last_message.created_at),
          fromSelf: t.last_message.sender_id === userId,
          senderName: t.last_message.sender_name,
        }
      : null,
  }));

  return [...dmItems, ...chatItems, ...teamItems];
}
