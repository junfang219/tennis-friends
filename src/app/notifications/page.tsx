"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Avatar from "@/components/Avatar";

type Notification = {
  id: string;
  type: string;
  postId: string;
  commentId: string;
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

function notificationText(type: string) {
  switch (type) {
    case "comment": return "commented on your post";
    case "reply": return "also commented on a post you commented on";
    case "like": return "liked your post";
    case "join_request": return "wants to join your game";
    case "request_approved": return "approved your request to join";
    case "request_rejected": return "declined your request to join";
    case "friend_request": return "sent you a friend request";
    case "friend_accepted": return "accepted your friend request";
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
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((data) => {
        setNotifications(data.notifications || []);
        setLoading(false);
        // Mark all as read
        fetch("/api/notifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
      })
      .catch(() => setLoading(false));
  }, [status]);

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

  const handleTap = (n: Notification) => {
    if (n.type === "friend_request" || n.type === "friend_accepted") {
      router.push(`/profile/${n.actor.id}`);
    } else if (n.postId) {
      router.push(`/?post=${n.postId}`);
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
        <div className="space-y-2">
          {notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => handleTap(n)}
              className={`w-full text-left flex items-start gap-3 p-4 rounded-xl transition-colors ${
                n.read ? "bg-white" : "bg-court-green/5"
              } shadow-sm border border-court-green-pale/20 active:bg-gray-50`}
            >
              <div className="relative shrink-0">
                <Avatar name={n.actor.name} image={n.actor.profileImageUrl} size="md" />
                <div className="absolute -bottom-1 -right-1">
                  {notificationIcon(n.type)}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800">
                  <span className="font-semibold">{n.actor.name}</span>{" "}
                  {notificationText(n.type)}
                </p>
                <p className="text-xs text-gray-400 mt-1">{timeAgo(n.createdAt)}</p>
              </div>
              {!n.read && (
                <div className="w-2.5 h-2.5 rounded-full bg-court-green shrink-0 mt-1.5" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
