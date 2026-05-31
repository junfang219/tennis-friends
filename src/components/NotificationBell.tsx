"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname } from "next/navigation";
import Avatar from "./Avatar";
import PostDetailModal from "./PostDetailModal";
import { emojiFor } from "@/lib/reactions";
import { useSession } from "@/lib/supabase/nextauth-compat";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  listPendingRequests,
  acceptFriendRequest as sbAcceptFriendRequest,
  rejectFriendRequest as sbRejectFriendRequest,
  deleteNotification,
  getNotification,
  listNotifications,
  markAllNotificationsRead,
  unreadNotificationCount,
} from "@/lib/supabase/queries";
import { toNotificationCamel } from "@/lib/supabase/adapters";
import { errorMessage } from "@/lib/errorMessage";

type Notification = {
  id: string;
  type: string;
  postId: string;
  commentId: string;
  messageId: string;
  eventId: string;
  matchId: string;
  emoji: string;
  read: boolean;
  createdAt: string;
  actor: { id: string; name: string; profileImageUrl: string };
};

function timeAgo(date: string) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function notificationText(n: { type: string; emoji?: string }) {
  switch (n.type) {
    case "comment": return "commented on your post";
    case "reply": return "replied to your comment";
    case "like": return "liked your post";
    case "join_request": return "wants to join your game";
    case "request_approved": return "approved your request to join";
    case "request_rejected": return "declined your request to join";
    case "friend_request": return "sent you a friend request";
    case "friend_accepted": return "accepted your friend request — you're now friends!";
    case "message_reaction": {
      const symbol = n.emoji ? (emojiFor(n.emoji) || n.emoji) : "";
      return symbol ? `reacted ${symbol} to your message` : "reacted to your message";
    }
    case "event_invite": return "invited you to an event";
    case "event_signup": return "signed up for your event";
    case "event_ladder_challenge": return "challenged you on the ladder";
    case "event_match_report": return "reported a match score — confirm or dispute";
    case "event_match_confirmed": return "confirmed your reported score";
    case "event_match_disputed": return "disputed your reported score";
    case "event_challenge_accepted": return "accepted your ladder challenge";
    case "event_challenge_declined": return "declined your ladder challenge";
    default: return "interacted with your post";
  }
}

function notificationIcon(type: string) {
  switch (type) {
    case "comment":
    case "reply":
      return (
        <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-blue-600" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        </div>
      );
    case "like":
      return (
        <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-red-500">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </div>
      );
    case "join_request":
      return (
        <div className="w-6 h-6 rounded-full bg-court-green flex items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-ball-yellow" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
        </div>
      );
    case "request_approved":
      return (
        <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-green-600" strokeLinecap="round">
            <polyline points="20,6 9,17 4,12" />
          </svg>
        </div>
      );
    case "request_rejected":
      return (
        <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-gray-500" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </div>
      );
    case "friend_request":
      return (
        <div className="w-6 h-6 rounded-full bg-court-green flex items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-ball-yellow">
            <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <line x1="20" y1="8" x2="20" y2="14" />
            <line x1="23" y1="11" x2="17" y2="11" />
          </svg>
        </div>
      );
    case "friend_accepted":
      return (
        <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-600">
            <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <polyline points="17 11 19 13 23 9" />
          </svg>
        </div>
      );
    case "message_reaction":
      return (
        <div className="w-6 h-6 rounded-full bg-pink-100 flex items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-pink-500">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </div>
      );
    case "event_invite":
      return (
        <div className="w-6 h-6 rounded-full bg-ball-yellow flex items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-court-green" strokeLinecap="round" strokeLinejoin="round">
            <ellipse cx="7" cy="6.5" rx="3" ry="4" transform="rotate(-25 7 6.5)" />
            <line x1="9" y1="9.5" x2="17" y2="21.5" />
            <ellipse cx="17" cy="6.5" rx="3" ry="4" transform="rotate(25 17 6.5)" />
            <line x1="15" y1="9.5" x2="7" y2="21.5" />
          </svg>
        </div>
      );
    case "event_signup":
      return (
        <div className="w-6 h-6 rounded-full bg-court-green flex items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-ball-yellow" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <line x1="20" y1="8" x2="20" y2="14" />
            <line x1="23" y1="11" x2="17" y2="11" />
          </svg>
        </div>
      );
    case "event_ladder_challenge":
    case "event_challenge_accepted":
    case "event_challenge_declined":
      return (
        <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center">
          <span className="text-xs">🪜</span>
        </div>
      );
    case "event_match_report":
    case "event_match_confirmed":
    case "event_match_disputed":
      return (
        <div className="w-6 h-6 rounded-full bg-ball-yellow flex items-center justify-center">
          <span className="text-xs">🎾</span>
        </div>
      );
    default:
      return null;
  }
}

type FriendRequest = {
  friendshipId: string;
  user: { id: string; name: string; profileImageUrl: string; skillLevel: string };
  createdAt: string;
};

export default function NotificationBell() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingFriendRequests, setPendingFriendRequests] = useState(0);
  const [open, setOpen] = useState(false);
  // Notification → post-detail flow. PostDetailModal owns the fetch +
  // loading skeleton internally; we just track which post is open.
  const [openPostId, setOpenPostId] = useState<string | null>(null);
  const [openWithComments, setOpenWithComments] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchorPos, setAnchorPos] = useState<{ top: number; right: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Friend requests sub-view (inline, like Instagram)
  const [showFriendRequests, setShowFriendRequests] = useState(false);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [friendReqLoading, setFriendReqLoading] = useState(false);
  const [friendReqAction, setFriendReqAction] = useState("");
  const [friendReqError, setFriendReqError] = useState("");

  const openPostModal = (postId: string, withComments = false) => {
    if (!postId) return;
    setOpen(false);
    setOpenWithComments(withComments);
    setOpenPostId(postId);
  };

  const handleDelete = async (id: string) => {
    const previous = notifications;
    const wasUnread = notifications.find((n) => n.id === id)?.read === false;
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1));
    try {
      const supabase = createSupabaseBrowserClient();
      await deleteNotification(supabase, id);
    } catch {
      setNotifications(previous);
      if (wasUnread) setUnreadCount((c) => c + 1);
    }
  };

  const handleNotificationClick = (n: Notification) => {
    if (n.type === "friend_request" || n.type === "friend_accepted") {
      setOpen(false);
      router.push(`/profile/${n.actor.id}`);
      return;
    }
    if (n.type === "message_reaction") {
      setOpen(false);
      const target = n.messageId ? `/chat/${n.actor.id}?msg=${n.messageId}` : `/chat/${n.actor.id}`;
      router.push(target);
      return;
    }
    const eventTypes = new Set([
      "event_invite",
      "event_signup",
      "event_ladder_challenge",
      "event_match_report",
      "event_match_confirmed",
      "event_match_disputed",
      "event_challenge_accepted",
      "event_challenge_declined",
    ]);
    if (eventTypes.has(n.type) && n.eventId) {
      setOpen(false);
      const qs = n.matchId ? `?match=${n.matchId}` : "";
      router.push(`/events/${n.eventId}${qs}`);
      return;
    }
    const wantsComments = n.type === "comment" || n.type === "reply";
    if (n.postId) openPostModal(n.postId, wantsComments);
  };

  const loadFriendRequests = async () => {
    setFriendReqLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const rows = await listPendingRequests(supabase);
      const incoming: FriendRequest[] = rows
        .filter((r) => r.direction === "incoming")
        .map((r) => ({
          friendshipId: r.id,
          createdAt: r.created_at,
          user: {
            id: r.other.id,
            name: r.other.name,
            profileImageUrl: r.other.profile_image_url,
            skillLevel: r.other.skill_level,
          },
        }));
      setFriendRequests(incoming);
      setPendingFriendRequests(incoming.length);
    } catch {}
    setFriendReqLoading(false);
  };

  const acceptFriendRequest = async (friendshipId: string) => {
    setFriendReqAction(friendshipId);
    setFriendReqError("");
    try {
      const supabase = createSupabaseBrowserClient();
      await sbAcceptFriendRequest(supabase, friendshipId);
      setFriendRequests((prev) => prev.filter((r) => r.friendshipId !== friendshipId));
      setPendingFriendRequests((prev) => Math.max(0, prev - 1));
    } catch (err) {
      setFriendReqError(
        errorMessage(err, "Couldn't accept the request.")
      );
    }
    setFriendReqAction("");
  };

  const rejectFriendRequest = async (friendshipId: string) => {
    setFriendReqAction(friendshipId);
    setFriendReqError("");
    try {
      const supabase = createSupabaseBrowserClient();
      await sbRejectFriendRequest(supabase, friendshipId);
      setFriendRequests((prev) => prev.filter((r) => r.friendshipId !== friendshipId));
      setPendingFriendRequests((prev) => Math.max(0, prev - 1));
    } catch (err) {
      setFriendReqError(
        errorMessage(err, "Couldn't decline the request.")
      );
    }
    setFriendReqAction("");
  };

  const openFriendRequestsView = () => {
    setShowFriendRequests(true);
    loadFriendRequests();
  };

  const loadNotifications = async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      const [rows, unread, pending] = await Promise.all([
        listNotifications(supabase),
        unreadNotificationCount(supabase),
        listPendingRequests(supabase),
      ]);
      setNotifications(rows.map(toNotificationCamel) as unknown as Notification[]);
      setUnreadCount(unread);
      setPendingFriendRequests(pending.filter((r) => r.direction === "incoming").length);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadNotifications();
    // 60s safety poll; Supabase Realtime is the primary signal.
    pollRef.current = setInterval(loadNotifications, 60000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Subscribe to notification INSERTs/UPDATEs and update state
  // incrementally. RLS scopes the stream to rows for this user.
  //
  // Previously we called the full loadNotifications() (three queries in
  // parallel: list + unread count + pending friend requests) on every
  // realtime event — that added 200–500ms of network round-trip on top
  // of Supabase Realtime's own latency, so a new comment took noticeably
  // long to surface in the bell. Now we hydrate just the single new
  // row and patch state.
  useEffect(() => {
    if (!userId) return;
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        async (payload) => {
          const id = (payload.new as { id?: string }).id;
          if (!id) {
            loadNotifications();
            return;
          }
          try {
            const row = await getNotification(supabase, id);
            if (!row) return;
            const adapted = toNotificationCamel(row) as unknown as Notification;
            setNotifications((prev) =>
              prev.some((n) => n.id === adapted.id) ? prev : [adapted, ...prev]
            );
            // The new row is always unread (the trigger inserts with the
            // table default `false`).
            setUnreadCount((c) => c + 1);
            // Friend-request notifications also feed the side-panel
            // pending list. The notifications stream doesn't carry
            // friendship rows so we still need that single re-fetch.
            if (row.type === "friend_request") {
              const pending = await listPendingRequests(supabase);
              setPendingFriendRequests(pending.filter((r) => r.direction === "incoming").length);
            }
          } catch {
            // Fallback to the full refresh if the targeted fetch fails.
            loadNotifications();
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const next = payload.new as { id?: string; read?: boolean };
          const prev = payload.old as { read?: boolean };
          if (!next.id) return;
          setNotifications((list) =>
            list.map((n) => (n.id === next.id ? { ...n, read: !!next.read } : n))
          );
          // Most UPDATEs flip read false→true. Decrement once.
          if (prev?.read === false && next.read === true) {
            setUnreadCount((c) => Math.max(0, c - 1));
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // Close any open modal/dropdown when the route changes (e.g. tapping
  // "Open chat" inside the post-detail modal navigates to /chat/group/[id]).
  // The bell sits in the persistent layout so its state would otherwise
  // survive navigation and leave stale overlays on top of the new page.
  useEffect(() => {
    setOpenPostId(null);
    setOpen(false);
    setShowFriendRequests(false);
  }, [pathname]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      const insideDropdown = dropdownRef.current?.contains(target);
      const insideButton = buttonRef.current?.contains(target);
      if (!insideDropdown && !insideButton) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  // Position the portal-rendered dropdown relative to the bell button.
  // The dropdown is w-80 (320px) but the bell sits near the right edge of
  // the navbar, so a naive `right: innerWidth - rect.right` shoves the
  // dropdown's left edge off-screen on narrow mobile viewports. Clamp the
  // right anchor against the effective dropdown width — which itself caps
  // at viewport-minus-margins via the max-w class — so the dropdown always
  // stays inside the viewport with at least an 8px gutter on each side.
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

  const handleOpen = () => {
    if (open) {
      // Closing — reset sub-view
      setShowFriendRequests(false);
    }
    setOpen(!open);
    if (!open && unreadCount > 0) {
      // Mark all as read when opening
      const supabase = createSupabaseBrowserClient();
      void markAllNotificationsRead(supabase).then(() => setUnreadCount(0));
    }
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleOpen}
        className="relative p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/8 transition-colors"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 01-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1 border-2 border-court-green">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && anchorPos && typeof document !== "undefined" && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: "fixed", top: anchorPos.top, right: anchorPos.right, zIndex: 500 }}
          className="w-80 max-w-[calc(100vw-16px)] bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden animate-fade-in-up"
        >

          {/* ── Friend Requests sub-view (Instagram-style) ── */}
          {showFriendRequests ? (
            <>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
                <button
                  onClick={() => setShowFriendRequests(false)}
                  className="w-7 h-7 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <h3 className="font-display text-base font-bold text-gray-900">Friend Requests</h3>
              </div>
              {friendReqError && (
                <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {friendReqError}
                </div>
              )}
              <div className="max-h-96 overflow-y-auto">
                {friendReqLoading ? (
                  <div className="flex justify-center py-10">
                    <svg className="animate-spin w-5 h-5 text-court-green" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                      <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  </div>
                ) : friendRequests.length === 0 ? (
                  <div className="text-center py-10 px-4">
                    <p className="text-sm text-gray-500">No pending requests</p>
                  </div>
                ) : (
                  friendRequests.map((r) => (
                    <div key={r.friendshipId} className="px-4 py-3 border-b border-gray-50 last:border-b-0">
                      <div className="flex items-center gap-3">
                        <button onClick={() => { setOpen(false); router.push(`/profile/${r.user.id}`); }} className="shrink-0">
                          <Avatar name={r.user.name} image={r.user.profileImageUrl} size="md" />
                        </button>
                        <div className="flex-1 min-w-0">
                          <button
                            onClick={() => { setOpen(false); router.push(`/profile/${r.user.id}`); }}
                            className="text-sm font-semibold text-gray-900 hover:text-court-green transition-colors truncate block max-w-full"
                          >
                            {r.user.name}
                          </button>
                          {r.createdAt && (
                            <p className="text-[11px] text-gray-400">{timeAgo(r.createdAt)}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-2 ml-11">
                        <button
                          onClick={() => acceptFriendRequest(r.friendshipId)}
                          disabled={friendReqAction === r.friendshipId}
                          className="flex-1 py-1.5 bg-court-green text-white text-[11px] font-semibold rounded-lg hover:bg-court-green-light disabled:opacity-50 transition-colors"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => rejectFriendRequest(r.friendshipId)}
                          disabled={friendReqAction === r.friendshipId}
                          className="flex-1 py-1.5 bg-gray-100 text-gray-700 text-[11px] font-semibold rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            /* ── Main notifications view ── */
            <>
              <div className="p-4 border-b border-gray-100">
                <h3 className="font-display text-lg font-bold text-gray-900">Notifications</h3>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {/* Friend Requests banner — click opens inline sub-view */}
                {pendingFriendRequests > 0 && (
                  <button
                    onClick={openFriendRequestsView}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100 bg-court-green/5"
                  >
                    <div className="w-10 h-10 rounded-full bg-court-green flex items-center justify-center flex-shrink-0">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ball-yellow">
                        <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                        <circle cx="8.5" cy="7" r="4" />
                        <line x1="20" y1="8" x2="20" y2="14" />
                        <line x1="23" y1="11" x2="17" y2="11" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-sm font-semibold text-gray-900">Friend Requests</p>
                      <p className="text-xs text-gray-500">{pendingFriendRequests} pending request{pendingFriendRequests !== 1 ? "s" : ""}</p>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-gray-400 flex-shrink-0">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                )}

                {notifications.filter((n) => n.type !== "friend_request").length === 0 && pendingFriendRequests === 0 ? (
                  <div className="text-center py-12 px-4">
                    <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400">
                        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      </svg>
                    </div>
                    <p className="text-sm text-gray-500">No notifications yet</p>
                  </div>
                ) : (
                  notifications.filter((n) => n.type !== "friend_request").map((n) => (
                    <div key={n.id} className="group relative">
                      <button
                        onClick={() => handleNotificationClick(n)}
                        className={`w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors ${
                          !n.read ? "bg-court-green-soft/5" : ""
                        }`}
                      >
                        <div className="relative shrink-0">
                          <Avatar name={n.actor.name} image={n.actor.profileImageUrl} size="md" />
                          <div className="absolute -bottom-1 -right-1">
                            {notificationIcon(n.type)}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0 pr-6">
                          <p className="text-sm text-gray-700">
                            <span className="font-semibold text-gray-900">{n.actor.name}</span>{" "}
                            {notificationText(n)}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">{timeAgo(n.createdAt)}</p>
                        </div>
                        {!n.read && (
                          <div className="w-2 h-2 rounded-full bg-court-green-soft mt-2 shrink-0" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDelete(n.id); }}
                        aria-label="Delete notification"
                        className="hidden md:flex absolute top-2 right-2 z-10 w-7 h-7 items-center justify-center rounded-full bg-gray-200 text-gray-700 shadow-md hover:bg-red-500 hover:text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>,
        document.body
      )}

      <PostDetailModal
        postId={openPostId}
        withComments={openWithComments}
        onClose={() => setOpenPostId(null)}
      />
    </div>
  );
}
