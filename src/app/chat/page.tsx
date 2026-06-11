"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import ConversationRow, { type InboxItem, type InboxAction } from "@/components/ConversationRow";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useRealtimeTable } from "@/lib/supabase/realtime";
import { markDmRead, markChatRead, markTeamRead } from "@/lib/supabase/queries";
import { useCachedQuery } from "@/lib/useCachedQuery";
import { loadInbox } from "@/lib/inboxLoader";
import { buildInboxSections } from "@/lib/inboxSections";
import { useIsDesktopChat } from "@/hooks/useIsDesktopChat";

export default function ChatPage() {
  const { status, data: session } = useSession();
  const router = useRouter();
  const isDesktop = useIsDesktopChat();
  const [openRowKey, setOpenRowKey] = useState<string | null>(null);

  // Cached inbox: paints instantly on revisit, refetches in background.
  // Fetcher lives in src/lib/inboxLoader.ts so this page, /friends, and
  // MessageBell all populate the same cache key with the same shape.
  const inbox = useCachedQuery<InboxItem[]>(
    status === "authenticated" ? "chat:inbox" : null,
    () => loadInbox(createSupabaseBrowserClient(), session?.user?.id),
  );
  // Memoize so identity is stable when inbox.data is unchanged — keeps the
  // prefetch effect below from firing on every render.
  const items = useMemo<InboxItem[]>(() => inbox.data ?? [], [inbox.data]);
  const loading = inbox.isLoading;
  const loadError = inbox.error
    ? inbox.error.message || "Couldn't load messages."
    : "";

  // Warm the route cache for every thread visible in the inbox so tapping
  // one navigates instantly instead of cold-downloading the page chunk.
  // Required because rows use router.push() (not <Link>) for the swipe
  // gesture — that path skips Next.js' automatic prefetch.
  useEffect(() => {
    for (const it of items) {
      router.prefetch(it.href);
    }
  }, [items, router]);

  // The initial fetch is owned by useCachedQuery — no separate mount effect.

  // Realtime: refresh the inbox when an incoming DM, session chat, or
  // group chat message arrives. The polling fallback the SSE stream
  // used to drive is gone; without these subscriptions unread badges
  // would stay stale until manual reload. Each table gets its own
  // channel because the postgres_changes filter syntax doesn't OR
  // across tables. listDmThreads / listMyChats are cheap enough that
  // re-running both on any signal isn't expensive.
  const me = session?.user?.id;
  const refetchInbox = inbox.refetch;
  useRealtimeTable(
    {
      table: "messages",
      event: "INSERT",
      filter: me ? `receiver_id=eq.${me}` : undefined,
      onChange: () => { void refetchInbox(); },
    },
    [me, refetchInbox]
  );
  // chat_messages (session chats) has no single-column "messages I can
  // see" filter; RLS does the heavy lifting (Realtime applies SELECT
  // policies before delivery) so subscribing without a filter is safe.
  // Skip self-sent messages — they wouldn't change the unread badge.
  useRealtimeTable(
    {
      table: "chat_messages",
      event: "INSERT",
      onChange: (payload) => {
        const senderId = (payload.new as { sender_id?: string } | null)?.sender_id;
        if (senderId && senderId === me) return;
        void refetchInbox();
      },
    },
    [me, refetchInbox]
  );
  // group_messages (team chats) — same shape as chat_messages.
  useRealtimeTable(
    {
      table: "group_messages",
      event: "INSERT",
      onChange: (payload) => {
        const senderId = (payload.new as { sender_id?: string } | null)?.sender_id;
        if (senderId && senderId === me) return;
        void refetchInbox();
      },
    },
    [me, refetchInbox]
  );

  // Escape closes any open swipe row
  useEffect(() => {
    if (!openRowKey) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenRowKey(null);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [openRowKey]);

  const applyAction = async (item: InboxItem, action: InboxAction) => {
    inbox.mutate((prev) => {
      const source = prev ?? [];
      let next = source.map((it) => {
        if (`${it.type}-${it.id}` !== `${item.type}-${item.id}`) return it;
        switch (action) {
          case "pin":
            return { ...it, pinnedAt: new Date().toISOString() };
          case "unpin":
            return { ...it, pinnedAt: null };
          case "mute":
            return { ...it, muted: true };
          case "unmute":
            return { ...it, muted: false };
          case "markUnread":
            return { ...it, unreadCount: Math.max(1, it.unreadCount) };
          case "hide":
            return it;
        }
      });
      if (action === "hide") {
        next = next.filter((it) => `${it.type}-${it.id}` !== `${item.type}-${item.id}`);
      }
      next.sort((a, b) => {
        const ap = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
        const bp = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;
        if (ap && !bp) return -1;
        if (!ap && bp) return 1;
        if (ap && bp) return bp - ap;
        return 0;
      });
      return next;
    });
    setOpenRowKey(null);

    // Pin/mute/markUnread/hide on a conversation row have nuanced server
    // semantics. For now, mark-as-read on tap is what matters most.
    if (action === "markUnread") return;
    try {
      const supabase = createSupabaseBrowserClient();
      if (item.type === "direct") {
        await markDmRead(supabase, item.id);
      } else if (item.type === "group") {
        await markChatRead(supabase, item.id);
      } else if (item.type === "team") {
        await markTeamRead(supabase, item.id);
      }
    } catch {
      // Best-effort
    }
  };

  // Desktop two-pane: the layout already renders the conversation list in
  // the left sidebar, so /chat itself becomes a right-pane empty state.
  if (isDesktop) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div className="max-w-sm">
          <div className="w-16 h-16 bg-court-green-pale/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-court-green" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
          </div>
          <h2 className="font-display text-lg font-bold text-gray-800 mb-1">Your messages</h2>
          <p className="text-sm text-gray-500">
            Select a conversation from the list to start chatting.
          </p>
        </div>
      </div>
    );
  }

  if (status === "loading" || loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="font-display text-2xl font-bold text-court-green mb-4">Messages</h1>
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-xl p-4 shadow-sm flex items-center gap-3">
              <div className="skeleton w-12 h-12 rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="skeleton w-32 h-4" />
                <div className="skeleton w-48 h-3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="font-display text-2xl font-bold text-court-green mb-4">Messages</h1>

      {loadError && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {loadError}{" "}
          <button
            onClick={() => { void refetchInbox(); }}
            className="underline font-semibold ml-1"
          >
            Retry
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-court-green-pale/20">
          <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
          </div>
          <h3 className="font-display text-lg font-bold text-gray-800 mb-2">No messages yet</h3>
          <p className="text-gray-500 text-sm">Start a conversation with a friend or team member!</p>
        </div>
      ) : (
        <>
          {(() => {
            const sections = buildInboxSections(items);

            const renderRow = (item: InboxItem) => {
              const key = `${item.type}-${item.id}`;
              return (
                <ConversationRow
                  key={key}
                  item={item}
                  isOpen={openRowKey === key}
                  onOpen={() => setOpenRowKey(key)}
                  onClose={() => setOpenRowKey((k) => (k === key ? null : k))}
                  onSelect={() => {
                    // Clear the unread badge in-place the moment the user
                    // taps. The destination chat page also calls markRead
                    // on mount, but the inbox refetch can lag a beat —
                    // without this the badge would flash back on for ~60s
                    // until the realtime tick reconciles.
                    if (item.unreadCount > 0) {
                      inbox.mutate((prev) =>
                        (prev ?? []).map((it) =>
                          it.type === item.type && it.id === item.id
                            ? { ...it, unreadCount: 0 }
                            : it,
                        ),
                      );
                    }
                    router.push(item.href);
                  }}
                  onAction={(action) => applyAction(item, action)}
                  layout="page"
                />
              );
            };

            return (
              <>
                {sections.map((section) => (
                  <div key={section.key} className="mb-4">
                    <div className="flex items-center gap-2 px-1 mb-2">
                      <h2 className={`font-display text-xs font-bold tracking-wider uppercase ${section.headerClass}`}>
                        {section.header}
                      </h2>
                      {section.caption && (
                        <span className="text-[10px] text-gray-400">{section.caption}</span>
                      )}
                    </div>
                    <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 overflow-hidden divide-y divide-gray-100">
                      {section.items.map(renderRow)}
                    </div>
                  </div>
                ))}
              </>
            );
          })()}
        </>
      )}
    </div>
  );
}
