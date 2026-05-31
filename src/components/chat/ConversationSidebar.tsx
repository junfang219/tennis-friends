"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import ConversationRow, { type InboxItem, type InboxAction } from "@/components/ConversationRow";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useRealtimeTable } from "@/lib/supabase/realtime";
import { markDmRead, markChatRead, markTeamRead } from "@/lib/supabase/queries";
import { useCachedQuery } from "@/lib/useCachedQuery";
import { loadInbox } from "@/lib/inboxLoader";

// Map the current pathname to the inbox-row key that ConversationRow can match against.
// Patterns:
//   /chat/<userId>        → direct-<userId>
//   /chat/group/<chatId>  → group-<chatId>
//   /groups/<id>/chat     → team-<id>
function selectionKeyFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  if (pathname.startsWith("/chat/group/")) {
    const id = pathname.split("/")[3];
    return id ? `group-${id}` : null;
  }
  if (pathname.startsWith("/chat/")) {
    const id = pathname.split("/")[2];
    return id ? `direct-${id}` : null;
  }
  const teamMatch = pathname.match(/^\/groups\/([^/]+)\/chat/);
  if (teamMatch) return `team-${teamMatch[1]}`;
  return null;
}

export default function ConversationSidebar() {
  const { status, data: session } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [openRowKey, setOpenRowKey] = useState<string | null>(null);
  const selectedKey = selectionKeyFromPath(pathname);

  const inbox = useCachedQuery<InboxItem[]>(
    status === "authenticated" ? "chat:inbox" : null,
    () => loadInbox(createSupabaseBrowserClient(), session?.user?.id),
  );
  const items = useMemo<InboxItem[]>(() => inbox.data ?? [], [inbox.data]);
  const loading = inbox.isLoading;

  const me = session?.user?.id;
  const refetchInbox = inbox.refetch;

  // Same three subscriptions as /chat/page.tsx so unread badges and the
  // last-message preview stay live while a chat is open in the right pane.
  useRealtimeTable(
    {
      table: "messages",
      event: "INSERT",
      filter: me ? `receiver_id=eq.${me}` : undefined,
      onChange: () => { void refetchInbox(); },
    },
    [me, refetchInbox]
  );
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

  const sessionItems = items
    .filter((i) => i.type === "group" && i.kind === "session")
    .sort((a, b) => {
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
        isSelected={selectedKey === key}
        onOpen={() => setOpenRowKey(key)}
        onClose={() => setOpenRowKey((k) => (k === key ? null : k))}
        onSelect={() => router.push(item.href)}
        onAction={(action) => applyAction(item, action)}
        layout="page"
      />
    );
  };

  return (
    <aside className="w-[360px] shrink-0 h-full border-r border-court-green-pale/30 bg-white flex flex-col">
      <div className="px-4 py-4 border-b border-court-green-pale/20 shrink-0">
        <h1 className="font-display text-xl font-bold text-court-green">Messages</h1>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && items.length === 0 ? (
          <div className="px-4 py-4 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white rounded-xl p-3 flex items-center gap-3">
                <div className="skeleton w-12 h-12 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton w-32 h-4" />
                  <div className="skeleton w-48 h-3" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-gray-400">
            No conversations yet.
          </div>
        ) : (
          <>
            {sessionItems.length > 0 && (
              <div className="border-b border-gray-100">
                <div className="flex items-center gap-2 px-4 pt-3 pb-1">
                  <h2 className="font-display text-[10px] font-bold tracking-wider uppercase text-court-green">
                    Upcoming games
                  </h2>
                </div>
                <div className="divide-y divide-gray-100">
                  {sessionItems.map(renderRow)}
                </div>
              </div>
            )}
            {otherItems.length > 0 && (
              <div className="divide-y divide-gray-100">
                {otherItems.map(renderRow)}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
