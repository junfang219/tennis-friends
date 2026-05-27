"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import ConversationRow, { type InboxItem, type InboxAction } from "@/components/ConversationRow";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useRealtimeTable } from "@/lib/supabase/realtime";
import { listDmThreads, listMyChats, markDmRead, markChatRead } from "@/lib/supabase/queries";
import { pgToIso } from "@/lib/pgDate";

export default function ChatPage() {
  const { status, data: session } = useSession();
  const router = useRouter();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [openRowKey, setOpenRowKey] = useState<string | null>(null);

  const loadInbox = useCallback(async () => {
    setLoadError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const [dms, chats] = await Promise.all([
        listDmThreads(supabase),
        listMyChats(supabase),
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
          // Postgres "2026-05-21 18:23:35+00" → strict ISO so iOS Safari's
          // Date parser doesn't NaN out and render "Invalid Date".
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
      setItems([...dmItems, ...chatItems]);
      setLoading(false);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't load messages.");
      setLoading(false);
    }
  }, []);

  // Warm the route cache for every thread visible in the inbox so tapping
  // one navigates instantly instead of cold-downloading the page chunk.
  // Required because rows use router.push() (not <Link>) for the swipe
  // gesture — that path skips Next.js' automatic prefetch.
  useEffect(() => {
    for (const it of items) {
      router.prefetch(it.href);
    }
  }, [items, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    loadInbox();
  }, [status, loadInbox]);

  // Realtime: refresh the inbox when an incoming DM, session chat, or
  // group chat message arrives. The polling fallback the SSE stream
  // used to drive is gone; without these subscriptions unread badges
  // would stay stale until manual reload. Each table gets its own
  // channel because the postgres_changes filter syntax doesn't OR
  // across tables. listDmThreads / listMyChats are cheap enough that
  // re-running both on any signal isn't expensive.
  const me = session?.user?.id;
  useRealtimeTable(
    {
      table: "messages",
      event: "INSERT",
      filter: me ? `receiver_id=eq.${me}` : undefined,
      onChange: () => { void loadInbox(); },
    },
    [me, loadInbox]
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
        void loadInbox();
      },
    },
    [me, loadInbox]
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
    setItems((prev) => {
      let next = prev.map((it) => {
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
      }
    } catch {
      // Best-effort
    }
  };

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
            onClick={() => { setLoading(true); void loadInbox(); }}
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
            const sessionItems = items
              .filter((i) => i.type === "group" && i.kind === "session")
              .sort((a, b) => {
                // Session-scoped: sort by upcoming game end (soonest first);
                // null end goes last.
                const aEnd = a.type === "group" && a.sessionEndAt ? new Date(a.sessionEndAt).getTime() : Infinity;
                const bEnd = b.type === "group" && b.sessionEndAt ? new Date(b.sessionEndAt).getTime() : Infinity;
                return aEnd - bEnd;
              });
            const otherItems = items.filter((i) => !(i.type === "group" && i.kind === "session"));

            const renderRow = (item: InboxItem) => {
              const key = `${item.type}-${item.id}`;
              return (
                <ConversationRow
                  key={key}
                  item={item}
                  isOpen={openRowKey === key}
                  onOpen={() => setOpenRowKey(key)}
                  onClose={() => setOpenRowKey((k) => (k === key ? null : k))}
                  onSelect={() => router.push(item.href)}
                  onAction={(action) => applyAction(item, action)}
                  layout="page"
                />
              );
            };

            return (
              <>
                {sessionItems.length > 0 && (
                  <div className="mb-4">
                    <div className="flex items-center gap-2 px-1 mb-2">
                      <h2 className="font-display text-xs font-bold tracking-wider uppercase text-court-green">
                        Upcoming games
                      </h2>
                      <span className="text-[10px] text-gray-400">
                        Auto-removes 3 days after the game
                      </span>
                    </div>
                    <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/40 overflow-hidden divide-y divide-gray-100">
                      {sessionItems.map(renderRow)}
                    </div>
                  </div>
                )}
                {otherItems.length > 0 && (
                  <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 overflow-hidden divide-y divide-gray-100">
                    {otherItems.map(renderRow)}
                  </div>
                )}
              </>
            );
          })()}
        </>
      )}
    </div>
  );
}
