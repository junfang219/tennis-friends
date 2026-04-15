"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import ConversationRow, { type InboxItem, type InboxAction } from "./ConversationRow";

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

  const loadInbox = useCallback(() => {
    fetch("/api/inbox")
      .then((r) => r.json())
      .then((data) => {
        if (data.items) setItems(data.items);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadInbox();
    pollRef.current = setInterval(loadInbox, 15000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadInbox]);

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

  // Position the portal-rendered dropdown relative to the bell button
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const update = () => {
      const rect = buttonRef.current!.getBoundingClientRect();
      setAnchorPos({
        top: rect.bottom + 8,
        right: Math.max(8, window.innerWidth - rect.right),
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

    // Persist the non-hide actions
    try {
      await fetch("/api/inbox/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: item.type, id: item.id, action }),
      });
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
          className="w-80 bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden animate-fade-in-up"
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
