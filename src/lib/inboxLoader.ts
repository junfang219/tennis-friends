// Shared fetcher for the conversations inbox.
//
// Used by /chat (Messages tab), /friends (Chats sub-tab), and the
// MessageBell dropdown. Centralized so all three render the same
// list — when /friends and /chat had separately maintained fetchers,
// adding team-chat support to one without the other meant whichever
// page populated the "chat:inbox" cache first won, and the team
// chats would flash in or out depending on the user's path.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./supabase/types";
import type { InboxItem } from "@/components/ConversationRow";
import {
  listDmThreads,
  listMyChats,
  listMyTeamThreads,
} from "./supabase/queries";
import { pgToIso } from "./pgDate";

export async function loadInbox(
  supabase: SupabaseClient<Database>,
  userId: string | undefined
): Promise<InboxItem[]> {
  const [dms, chats, teams] = await Promise.all([
    listDmThreads(supabase),
    listMyChats(supabase),
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

  const chatItems: InboxItem[] = chats.map((c) => ({
    type: "group" as const,
    id: c.id,
    title: c.name || "Session chat",
    href: `/chat/group/${c.id}`,
    unreadCount: 0,
    muted: false,
    pinnedAt: null,
    kind: "session" as const,
    lastMessage: null,
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
