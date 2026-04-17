"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import ConversationRow, { type InboxItem, type InboxAction } from "@/components/ConversationRow";

export default function ChatPage() {
  const { status } = useSession();
  const router = useRouter();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [openRowKey, setOpenRowKey] = useState<string | null>(null);

  const loadInbox = useCallback(() => {
    fetch("/api/inbox")
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    loadInbox();
  }, [status, loadInbox]);

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

    try {
      await fetch("/api/inbox/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: item.type, id: item.id, action }),
      });
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
