"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import Avatar from "./Avatar";
import PostCard from "./PostCard";

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
    default:
      return null;
  }
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [openPost, setOpenPost] = useState<Record<string, unknown> | null>(null);
  const [loadingPost, setLoadingPost] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const openPostModal = async (postId: string) => {
    if (!postId) return;
    setOpen(false);
    setOpenPost({}); // Show modal immediately
    setLoadingPost(true);
    try {
      const res = await fetch(`/api/posts/${postId}`);
      if (res.ok) {
        const data = await res.json();
        setOpenPost(data);
      } else {
        setOpenPost(null);
      }
    } catch {
      setOpenPost(null);
    }
    setLoadingPost(false);
  };

  const loadNotifications = () => {
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((data) => {
        if (data.notifications) {
          setNotifications(data.notifications);
          setUnreadCount(data.unreadCount || 0);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadNotifications();
    pollRef.current = setInterval(loadNotifications, 15000); // Poll every 15s
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  const handleOpen = () => {
    setOpen(!open);
    if (!open && unreadCount > 0) {
      // Mark all as read when opening
      fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }).then(() => {
        setUnreadCount(0);
      });
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
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

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden z-[100] animate-fade-in-up">
          <div className="p-4 border-b border-gray-100">
            <h3 className="font-display text-lg font-bold text-gray-900">Notifications</h3>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="text-center py-12 px-4">
                <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400">
                    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  </svg>
                </div>
                <p className="text-sm text-gray-500">No notifications yet</p>
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openPostModal(n.postId)}
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
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700">
                      <span className="font-semibold text-gray-900">{n.actor.name}</span>{" "}
                      {notificationText(n.type)}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{timeAgo(n.createdAt)}</p>
                  </div>
                  {!n.read && (
                    <div className="w-2 h-2 rounded-full bg-court-green-soft mt-2 shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Post detail modal */}
      {openPost !== null && createPortal(
        <div
          className="fixed inset-0 z-[999] bg-black/50 flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
          onClick={() => setOpenPost(null)}
        >
          <div className="w-full sm:max-w-lg sm:my-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end mb-2 px-2 sm:px-0">
              <button
                onClick={() => setOpenPost(null)}
                className="w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            {loadingPost || !openPost.id ? (
              <div className="bg-white rounded-2xl p-8 text-center">
                <svg className="animate-spin w-6 h-6 text-court-green mx-auto" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                  <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </div>
            ) : (
              <PostCard post={openPost as Parameters<typeof PostCard>[0]["post"]} />
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
