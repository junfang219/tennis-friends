"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import Avatar from "@/components/Avatar";
import PostDetailModal from "@/components/PostDetailModal";
import { emojiFor } from "@/lib/reactions";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  deleteNotification,
  listNotifications,
  markAllNotificationsRead,
} from "@/lib/supabase/queries";
import { getFacilityByCourtId } from "@/lib/facilities";
import { useCachedQuery } from "@/lib/useCachedQuery";

type Notification = {
  id: string;
  type: string;
  postId: string;
  commentId: string;
  messageId: string;
  chatId: string;
  groupId: string;
  chatMessageId: string;
  groupMessageId: string;
  eventId: string;
  matchId: string;
  pollId: string;
  friendGroupId: string;
  courtId: string;
  emoji: string;
  read: boolean;
  createdAt: string;
  actor: { id: string; name: string; profileImageUrl: string };
};

/** Venue name for a court_available alert ("tf-N" → display name). */
function courtAlertVenue(courtId: string): string {
  return getFacilityByCourtId(courtId)?.name ?? "A court";
}

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
    case "friend_accepted": return "accepted your friend request";
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
    case "group_invite_accepted": return "accepted your team invitation";
    case "club_invite": return "invited you to join a club";
    case "club_invite_accepted": return "accepted your club invitation";
    case "availability_poll": return "started an availability poll — mark your free times";
    case "court_available": return "has an open court — tap to book";
    default: return "interacted with your post";
  }
}

function notificationIcon(type: string) {
  switch (type) {
    case "comment":
    case "reply":
      return (
        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-blue-600" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        </div>
      );
    case "like":
      return (
        <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-red-500">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </div>
      );
    case "join_request":
      return (
        <div className="w-8 h-8 rounded-full bg-court-green flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-ball-yellow" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
        </div>
      );
    case "request_approved":
      return (
        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-green-600" strokeLinecap="round">
            <polyline points="20,6 9,17 4,12" />
          </svg>
        </div>
      );
    case "request_rejected":
      return (
        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-gray-500" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </div>
      );
    case "friend_request":
      return (
        <div className="w-8 h-8 rounded-full bg-court-green flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-ball-yellow">
            <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <line x1="20" y1="8" x2="20" y2="14" />
            <line x1="23" y1="11" x2="17" y2="11" />
          </svg>
        </div>
      );
    case "friend_accepted":
      return (
        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-600">
            <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <polyline points="17 11 19 13 23 9" />
          </svg>
        </div>
      );
    case "message_reaction":
      return (
        <div className="w-8 h-8 rounded-full bg-pink-100 flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-pink-500">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </div>
      );
    case "club_invite":
      return (
        <div className="w-8 h-8 rounded-full bg-court-green flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-ball-yellow">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
          </svg>
        </div>
      );
    case "club_invite_accepted":
      return (
        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-green-600">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <polyline points="17 11 19 13 23 9" />
          </svg>
        </div>
      );
    case "availability_poll":
      return (
        <div className="w-8 h-8 rounded-full bg-court-green-pale/30 flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="text-court-green-dark" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
            <polyline points="9,15 11,17 15,13" />
          </svg>
        </div>
      );
    case "court_available":
      return (
        <div className="w-8 h-8 rounded-full bg-ball-yellow flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="text-court-green" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 01-3.46 0" />
          </svg>
        </div>
      );
    default:
      return (
        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400" strokeLinecap="round">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 01-3.46 0" />
          </svg>
        </div>
      );
  }
}

export default function NotificationsPage() {
  const { status } = useSession();
  const router = useRouter();
  // Post-detail modal: comment/reply notifications open with comments
  // expanded; like notifications open the post without expansion. This
  // matches the in-app NotificationBell so the two surfaces feel the
  // same — important for iOS where /notifications is the primary path.
  const [openPostId, setOpenPostId] = useState<string | null>(null);
  const [openWithComments, setOpenWithComments] = useState(false);
  const [swipedKey, setSwipedKey] = useState<string | null>(null);

  const notifQuery = useCachedQuery<Notification[]>(
    status === "authenticated" ? "notifications:all" : null,
    async () => {
      const supabase = createSupabaseBrowserClient();
      const rows = await listNotifications(supabase);
      return rows.map((n) => ({
        id: n.id,
        type: n.type,
        postId: n.post_id ?? "",
        commentId: n.comment_id ?? "",
        messageId: n.message_id ?? "",
        chatId: n.chat_message?.chat_id ?? "",
        groupId: n.group_message?.group_id ?? "",
        chatMessageId: n.chat_message_id ?? "",
        groupMessageId: n.group_message_id ?? "",
        eventId: n.event_id ?? "",
        matchId: n.match_id ?? "",
        pollId: n.poll_id ?? "",
        friendGroupId: n.friend_group_id ?? "",
        courtId: n.court_id ?? "",
        emoji: n.emoji,
        read: n.read,
        createdAt: n.created_at,
        // Guest (accountless) actors have no profile join — fall back to the
        // stored guest name. Empty id → not a linkable profile.
        actor: {
          id: n.actor?.id ?? "",
          name: n.actor?.name ?? n.actor_guest_name ?? "Someone",
          profileImageUrl: n.actor?.profile_image_url ?? "",
        },
      }));
    },
  );
  const notifications = notifQuery.data ?? [];
  const loading = notifQuery.isLoading;

  // Mark-all-read fires once whenever we land on the page with a fresh batch
  // — independent of the cache layer so revisits also re-mark anything that
  // came in via realtime / background refresh.
  useEffect(() => {
    if (status !== "authenticated") return;
    if (!notifQuery.data) return;
    const supabase = createSupabaseBrowserClient();
    void markAllNotificationsRead(supabase);
  }, [status, notifQuery.data]);

  // Escape closes any open swipe row.
  useEffect(() => {
    if (!swipedKey) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSwipedKey(null);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [swipedKey]);

  const mutateNotifs = notifQuery.mutate;
  const refetchNotifs = notifQuery.refetch;
  const handleDelete = async (id: string) => {
    setSwipedKey(null);
    const previous = notifQuery.data;
    mutateNotifs((prev) => (prev ?? []).filter((n) => n.id !== id));
    try {
      const supabase = createSupabaseBrowserClient();
      await deleteNotification(supabase, id);
    } catch {
      // Roll back the optimistic removal and refetch to resync.
      mutateNotifs(previous ?? []);
      void refetchNotifs();
    }
  };

  if (status === "loading" || loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="font-display text-2xl font-bold text-court-green mb-4">Notifications</h1>
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-xl p-4 shadow-sm flex items-center gap-3">
              <div className="skeleton w-10 h-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="skeleton w-48 h-4" />
                <div className="skeleton w-24 h-3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const handleTap = async (n: Notification) => {
    if (n.type === "friend_request" || n.type === "friend_accepted") {
      router.push(`/profile/${n.actor.id}`);
      return;
    }
    if (n.type === "club_invite") {
      // Accept/Decline lives on the requests page (same as friend requests).
      router.push("/friends/requests");
      return;
    }
    if (n.type === "club_invite_accepted") {
      router.push("/friends");
      return;
    }
    if (n.type === "court_available" && n.courtId) {
      router.push(`/courts/${encodeURIComponent(n.courtId)}`);
      return;
    }
    if (n.type === "message_reaction") {
      // Route to the thread the reaction happened in: session/team chats by
      // their thread id, DM by the actor (with the reacted message anchored).
      const target = n.chatId
        ? `/chat/group/${n.chatId}${n.chatMessageId ? `?msg=${n.chatMessageId}` : ""}`
        : n.groupId
        ? `/groups/${n.groupId}/chat${n.groupMessageId ? `?msg=${n.groupMessageId}` : ""}`
        : n.messageId
        ? `/chat/${n.actor.id}?msg=${n.messageId}`
        : `/chat/${n.actor.id}`;
      router.push(target);
      return;
    }
    if (n.type === "availability_poll" && n.pollId) {
      // The notification carries the poll id but not the group id — poll URLs
      // are nested under /groups/[id]/availability/polls/[pollId], so we look
      // up the parent group on tap. Single-row lookup, sub-100ms in practice.
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase
        .from("availability_polls")
        .select("group_id")
        .eq("id", n.pollId)
        .maybeSingle();
      if (data?.group_id) {
        router.push(`/groups/${data.group_id}/availability/polls/${n.pollId}`);
      }
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
      const qs = n.matchId ? `?match=${n.matchId}` : "";
      router.push(`/events/${n.eventId}${qs}`);
      return;
    }
    if (n.postId) {
      // Open the post in a modal with comments expanded for
      // comment/reply notifications. Likes (and anything else
      // post-related) open without expansion. Matches NotificationBell.
      setOpenWithComments(n.type === "comment" || n.type === "reply");
      setOpenPostId(n.postId);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="font-display text-2xl font-bold text-court-green mb-4">Notifications</h1>

      {notifications.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-court-green-pale/20">
          <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400" strokeLinecap="round">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 01-3.46 0" />
            </svg>
          </div>
          <h3 className="font-display text-lg font-bold text-gray-800 mb-2">No notifications yet</h3>
          <p className="text-gray-500 text-sm">When someone interacts with your posts, you&apos;ll see it here.</p>
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-400 px-1 mb-2">
            <span className="md:hidden">Tip: swipe left on a notification to delete it.</span>
            <span className="hidden md:inline">Tip: hover over a notification to delete it.</span>
          </p>
          <div className="space-y-2">
            {notifications.map((n) => (
              <SwipeNotificationRow
                key={n.id}
                rowKey={n.id}
                swipedKey={swipedKey}
                setSwipedKey={setSwipedKey}
                onTap={() => handleTap(n)}
                onDelete={() => handleDelete(n.id)}
              >
                <div
                  className={`flex items-start gap-3 p-4 ${
                    n.read ? "bg-white" : "bg-court-green/5"
                  }`}
                >
                  <div className="relative shrink-0">
                    {n.type === "court_available" ? (
                      <div className="w-10 h-10 rounded-full bg-court-green-soft/15 flex items-center justify-center text-base">
                        🎾
                      </div>
                    ) : (
                      <Avatar name={n.actor.name} image={n.actor.profileImageUrl} size="md" />
                    )}
                    <div className="absolute -bottom-1 -right-1">
                      {notificationIcon(n.type)}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800">
                      <span className="font-semibold">
                        {n.type === "court_available"
                          ? courtAlertVenue(n.courtId)
                          : n.actor.name}
                      </span>{" "}
                      {notificationText(n)}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">{timeAgo(n.createdAt)}</p>
                  </div>
                  {!n.read && (
                    <div className="w-2.5 h-2.5 rounded-full bg-court-green shrink-0 mt-1.5" />
                  )}
                </div>
              </SwipeNotificationRow>
            ))}
          </div>
        </>
      )}

      <PostDetailModal
        postId={openPostId}
        withComments={openWithComments}
        onClose={() => setOpenPostId(null)}
      />
    </div>
  );
}

/* ───────── SwipeNotificationRow ─────────
 * Modeled on SwipeTeamRow in src/app/groups/page.tsx — drag the card
 * leftward to reveal a red "Delete" action; release past the open
 * threshold latches the row open, tap-on-card while open closes it
 * instead of navigating.
 */
function SwipeNotificationRow({
  rowKey,
  swipedKey,
  setSwipedKey,
  onTap,
  onDelete,
  children,
}: {
  rowKey: string;
  swipedKey: string | null;
  setSwipedKey: (k: string | null) => void;
  onTap: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  const ACTION_WIDTH = 96;
  const OPEN_THRESHOLD = 50;
  const swiped = swipedKey === rowKey;

  const [dragX, setDragX] = useState(0);
  const startXRef = useRef<number | null>(null);
  const startOffsetRef = useRef(0);
  const currentDragRef = useRef(0);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const suppressClickRef = useRef(false);

  const handleStart = (clientX: number) => {
    startXRef.current = clientX;
    startOffsetRef.current = swiped ? -ACTION_WIDTH : 0;
    currentDragRef.current = startOffsetRef.current;
    draggingRef.current = true;
    movedRef.current = false;
  };
  const handleMove = (clientX: number) => {
    if (!draggingRef.current || startXRef.current === null) return;
    const delta = clientX - startXRef.current;
    if (Math.abs(delta) > 5) movedRef.current = true;
    const next = Math.max(-ACTION_WIDTH, Math.min(0, startOffsetRef.current + delta));
    currentDragRef.current = next;
    setDragX(next);
  };
  const handleEnd = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const finalDrag = currentDragRef.current;
    const wasSwiped = swiped;
    const moved = movedRef.current;
    startXRef.current = null;

    if (moved) {
      suppressClickRef.current = true;
      setTimeout(() => { suppressClickRef.current = false; }, 350);
    }

    if (!moved) return;

    if (wasSwiped) {
      if (finalDrag > -ACTION_WIDTH + OPEN_THRESHOLD) {
        setDragX(0);
        setSwipedKey(null);
      } else {
        setDragX(-ACTION_WIDTH);
      }
    } else {
      if (finalDrag < -OPEN_THRESHOLD) {
        setDragX(-ACTION_WIDTH);
        setSwipedKey(rowKey);
      } else {
        setDragX(0);
      }
    }
  };

  useEffect(() => {
    if (swiped) setDragX(-ACTION_WIDTH);
    else setDragX(0);
  }, [swiped]);

  const offset = draggingRef.current ? dragX : swiped ? -ACTION_WIDTH : 0;

  return (
    <div className="relative overflow-hidden rounded-xl shadow-sm border border-court-green-pale/20 bg-white">
      <div className="absolute inset-y-0 right-0 flex items-stretch" style={{ width: ACTION_WIDTH }}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{ width: ACTION_WIDTH }}
          className="bg-red-500 text-white text-[11px] font-semibold flex flex-col items-center justify-center gap-1"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4a2 2 0 012-2h2a2 2 0 012 2v2" />
          </svg>
          Delete
        </button>
      </div>

      <div
        className="group relative bg-white"
        style={{
          transform: `translateX(${offset}px)`,
          transition: draggingRef.current ? "none" : "transform 0.25s ease-out",
          touchAction: "pan-y",
        }}
        onTouchStart={(e) => handleStart(e.touches[0].clientX)}
        onTouchMove={(e) => handleMove(e.touches[0].clientX)}
        onTouchEnd={handleEnd}
        onTouchCancel={handleEnd}
        onMouseDown={(e) => { handleStart(e.clientX); }}
        onMouseMove={(e) => { if (draggingRef.current) handleMove(e.clientX); }}
        onMouseUp={handleEnd}
      >
        <button
          type="button"
          onClick={(e) => {
            if (suppressClickRef.current) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            if (swiped) {
              setSwipedKey(null);
              return;
            }
            onTap();
          }}
          className="w-full text-left active:bg-gray-50"
        >
          {children}
        </button>
        {/* Desktop-only hover X. Touch users get the swipe gesture instead;
            hiding on small screens avoids a stuck-visible button after a
            tap (mobile browsers latch :hover on the last-tapped element). */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          aria-label="Delete notification"
          className={`hidden md:flex absolute top-2 right-2 z-10 w-8 h-8 items-center justify-center rounded-full bg-gray-200 text-gray-700 shadow-md hover:bg-red-500 hover:text-white transition-opacity ${swiped ? "opacity-0 pointer-events-none" : "opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
