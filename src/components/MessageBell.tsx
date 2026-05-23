"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import ConversationRow, { type InboxItem, type InboxAction } from "./ConversationRow";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { listDmThreads, listMyChats, markDmRead, markChatRead } from "@/lib/supabase/queries";
import { pgToIso } from "@/lib/pgDate";

// Per-user localStorage key so dismissals are scoped to the signed-in user.
const DISMISS_KEY = (userId: string) => `tf_msg_tray_dismissed_${userId}`;
type DismissMap = Record<string, string>; // `${type}-${id}` → ISO timestamp of when the user dismissed it

function loadDismissed(userId: string | undefined): DismissMap {
  if (!userId || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY(userId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDismissed(userId: string | undefined, map: DismissMap) {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISS_KEY(userId), JSON.stringify(map));
  } catch {
    // ignore quota errors
  }
}

export default function MessageBell() {
  const router = useRouter();
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const [items, setItems] = useState<InboxItem[]>([]);
  const [open, setOpen] = useState(false);
  const [openRowKey, setOpenRowKey] = useState<string | null>(null);
  // Persisted dismissal map (per-user): key → timestamp of dismissal.
  // An item is visible in the dropdown iff its latest message is newer than this timestamp
  // (or there's no entry). The chat remains on /chat and Friends > Chats regardless.
  const [dismissed, setDismissed] = useState<DismissMap>({});
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchorPos, setAnchorPos] = useState<{ top: number; right: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadInbox = useCallback(async () => {
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
          // pgToIso so iOS Safari's strict parser accepts the "+00" form
          // (timeAgo / dismissed-comparison both run new Date(createdAt)).
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
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadInbox();
    // Belt-and-suspenders poll every 60s; Realtime is the primary signal.
    pollRef.current = setInterval(loadInbox, 60000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadInbox]);

  // Subscribe to anything that could change my inbox count. RLS scopes the
  // event stream to rows I can already read, so a single channel is safe.
  useEffect(() => {
    if (!userId) return;
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`inbox-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `receiver_id=eq.${userId}` },
        () => loadInbox()
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        () => loadInbox()
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "group_messages" },
        () => loadInbox()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, loadInbox]);

  // Load persisted dismissals once we know the user
  useEffect(() => {
    setDismissed(loadDismissed(userId));
  }, [userId]);

  // Compute what's actually shown and the bell badge count from that.
  const visibleItems = items.filter((it) => {
    const key = `${it.type}-${it.id}`;
    const dismissedAt = dismissed[key];
    if (!dismissedAt) return true;
    // If a newer message arrived after dismissal, resurface the conversation.
    const lastAt = it.lastMessage?.createdAt;
    if (!lastAt) return false;
    return new Date(lastAt).getTime() > new Date(dismissedAt).getTime();
  });
  const totalUnread = visibleItems.reduce(
    (sum, it) => sum + (it.muted ? 0 : it.unreadCount),
    0,
  );

  // Centralised close helper — note: does NOT clear dismissed (persistent across refreshes).
  const closeDropdown = useCallback(() => {
    setOpen(false);
    setOpenRowKey(null);
  }, []);

  // Click outside to close — also resets any half-open row and dismissed items
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      const insideDropdown = dropdownRef.current?.contains(target);
      const insideButton = buttonRef.current?.contains(target);
      if (!insideDropdown && !insideButton) {
        closeDropdown();
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open, closeDropdown]);

  // Position the portal-rendered dropdown relative to the bell button.
  // Clamp the right anchor against the effective dropdown width so the
  // panel never overflows the left edge of a narrow viewport — same
  // pattern as NotificationBell. See that file for the full rationale.
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const update = () => {
      const rect = buttonRef.current!.getBoundingClientRect();
      const DROPDOWN_W = 320; // matches w-80
      const MARGIN = 8;
      const actualWidth = Math.min(DROPDOWN_W, window.innerWidth - 2 * MARGIN);
      const maxRight = window.innerWidth - actualWidth - MARGIN;
      const desiredRight = window.innerWidth - rect.right;
      setAnchorPos({
        top: rect.bottom + 8,
        right: Math.max(MARGIN, Math.min(desiredRight, maxRight)),
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  // Escape closes dropdown
  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (openRowKey) setOpenRowKey(null);
        else closeDropdown();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, openRowKey, closeDropdown]);

  const handleSelect = (item: InboxItem) => {
    closeDropdown();
    // Optimistically clear this conversation's unread count so the bell badge
    // updates immediately. The chat page will mark messages read on the server;
    // the next poll will reconcile.
    if (item.unreadCount > 0) {
      setItems((prev) =>
        prev.map((it) =>
          it.type === item.type && it.id === item.id ? { ...it, unreadCount: 0 } : it,
        ),
      );
    }
    router.push(item.href);
  };

  const applyAction = async (item: InboxItem, action: InboxAction) => {
    const key = `${item.type}-${item.id}`;
    setOpenRowKey(null);

    // "hide" in the top-nav dropdown = persistent-but-local dismissal.
    // It does NOT touch the server — the conversation stays on /chat and in Friends > Chats.
    // It DOES persist across page refreshes (stored in localStorage), so the item won't
    // return until the other side sends a new message.
    if (action === "hide") {
      const nextMap = { ...dismissed, [key]: new Date().toISOString() };
      setDismissed(nextMap);
      saveDismissed(userId, nextMap);
      return;
    }

    // Optimistic local update for the other four actions
    setItems((prev) => {
      const next = prev.map((it) => {
        if (`${it.type}-${it.id}` !== key) return it;
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
          default:
            return it;
        }
      });
      // Re-sort: pinned first (by pinnedAt desc), then server order preserved
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

    // Persist read state for the markUnread/read actions; pin / mute /
    // hide on a conversation row are UI-only state for now (per-user
    // chat_participants flags would need a server-side rebuild before
    // they're useful).
    try {
      const supabase = createSupabaseBrowserClient();
      if (action === "markUnread") {
        // intentional no-op — re-mark unread isn't representable in the
        // current direct_message_reads schema.
      } else if (item.type === "direct") {
        await markDmRead(supabase, item.id);
      } else if (item.type === "group") {
        await markChatRead(supabase, item.id);
      }
    } catch {
      // Best-effort; next poll will reconcile
    }
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => (open ? closeDropdown() : setOpen(true))}
        className="relative p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/8 transition-colors"
        title="Messages"
      >
        {/* Paper-plane / DM icon */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
        {totalUnread > 0 && (
          <span className="absolute top-1 right-1 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1 border-2 border-court-green">
            {totalUnread > 9 ? "9+" : totalUnread}
          </span>
        )}
      </button>

      {open && anchorPos && typeof document !== "undefined" && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: "fixed", top: anchorPos.top, right: anchorPos.right, zIndex: 500 }}
          className="w-80 max-w-[calc(100vw-16px)] bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden animate-fade-in-up"
        >
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-display text-lg font-bold text-gray-900">Messages</h3>
            {totalUnread > 0 && (
              <span className="text-xs font-semibold text-court-green-soft bg-court-green-pale/20 px-2 py-0.5 rounded-full">
                {totalUnread} new
              </span>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {(() => {
              if (visibleItems.length === 0) {
                return (
                  <div className="text-center py-12 px-4">
                    <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                      </svg>
                    </div>
                    <p className="text-sm text-gray-500">No conversations yet</p>
                  </div>
                );
              }
              return visibleItems.map((item) => {
                const key = `${item.type}-${item.id}`;
                return (
                  <ConversationRow
                    key={key}
                    item={item}
                    isOpen={openRowKey === key}
                    onOpen={() => setOpenRowKey(key)}
                    onClose={() => setOpenRowKey((k) => (k === key ? null : k))}
                    onSelect={() => handleSelect(item)}
                    onAction={(action) => applyAction(item, action)}
                    layout="dropdown"
                  />
                );
              });
            })()}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
