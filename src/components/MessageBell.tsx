"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Avatar from "./Avatar";

type DirectItem = {
  type: "direct";
  id: string;
  title: string;
  avatarUser: { id: string; name: string; profileImageUrl: string };
  lastMessage: { content: string; createdAt: string; fromSelf: boolean };
  unreadCount: number;
  href: string;
};

type GroupItem = {
  type: "group";
  id: string;
  title: string;
  participants: { id: string; name: string; profileImageUrl: string }[];
  lastMessage: { content: string; createdAt: string; fromSelf: boolean; senderName: string } | null;
  unreadCount: number;
  href: string;
};

type TeamItem = {
  type: "team";
  id: string;
  title: string;
  participants: { id: string; name: string; profileImageUrl: string }[];
  imageUrl?: string;
  lastMessage: { content: string; createdAt: string; fromSelf: boolean; senderName: string } | null;
  unreadCount: number;
  href: string;
};

type InboxItem = DirectItem | GroupItem | TeamItem;

function timeAgo(date: string) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function MessageBell() {
  const router = useRouter();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadInbox = () => {
    fetch("/api/inbox")
      .then((r) => r.json())
      .then((data) => {
        if (data.items) {
          setItems(data.items);
          setTotalUnread(data.totalUnread || 0);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadInbox();
    pollRef.current = setInterval(loadInbox, 15000);
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

  const handleSelect = (item: InboxItem) => {
    setOpen(false);
    router.push(item.href);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
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

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden z-[100] animate-fade-in-up">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-display text-lg font-bold text-gray-900">Messages</h3>
            {totalUnread > 0 && (
              <span className="text-xs font-semibold text-court-green-soft bg-court-green-pale/20 px-2 py-0.5 rounded-full">
                {totalUnread} new
              </span>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <div className="text-center py-12 px-4">
                <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </div>
                <p className="text-sm text-gray-500">No conversations yet</p>
              </div>
            ) : (
              items.map((item) => (
                <button
                  key={`${item.type}-${item.id}`}
                  onClick={() => handleSelect(item)}
                  className={`w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors ${
                    item.unreadCount > 0 ? "bg-court-green-soft/5" : ""
                  }`}
                >
                  <div className="shrink-0">
                    {item.type === "direct" ? (
                      <Avatar
                        name={item.avatarUser.name}
                        image={item.avatarUser.profileImageUrl}
                        size="md"
                      />
                    ) : item.type === "team" ? (
                      <div className="relative">
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt={item.title}
                            className="w-10 h-10 rounded-xl object-cover shadow-sm"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-court-green to-court-green-soft flex items-center justify-center text-white font-bold text-sm shadow-sm">
                            {item.title.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-ball-yellow flex items-center justify-center">
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-court-green">
                            <path d="M6 9H4.5a2.5 2.5 0 010-5H6" />
                            <path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
                            <path d="M4 22h16" />
                            <path d="M18 2H6v7a6 6 0 0012 0V2z" />
                          </svg>
                        </span>
                      </div>
                    ) : (
                      <div className="flex -space-x-3">
                        {item.participants.slice(0, 2).map((p) => (
                          <Avatar key={p.id} name={p.name} image={p.profileImageUrl} size="sm" />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-sm truncate ${item.unreadCount > 0 ? "font-bold text-gray-900" : "font-semibold text-gray-800"}`}>
                        {item.title}
                        {item.type === "team" && (
                          <span className="ml-1.5 text-[9px] font-bold tracking-wider text-court-green bg-court-green-pale/40 px-1 py-0.5 rounded uppercase">
                            Team
                          </span>
                        )}
                      </p>
                      <span className="text-[10px] text-gray-400 shrink-0">
                        {item.lastMessage ? timeAgo(item.lastMessage.createdAt) : ""}
                      </span>
                    </div>
                    <p className={`text-xs truncate mt-0.5 ${item.unreadCount > 0 ? "text-gray-700 font-medium" : "text-gray-500"}`}>
                      {item.lastMessage
                        ? `${item.lastMessage.fromSelf ? "You" : item.type === "group" || item.type === "team" ? item.lastMessage.senderName : ""}${item.lastMessage.fromSelf || item.type === "group" || item.type === "team" ? ": " : ""}${item.lastMessage.content || "(no text)"}`
                        : "No messages yet"}
                    </p>
                  </div>
                  {item.unreadCount > 0 && (
                    <span className="shrink-0 bg-court-green text-white text-[10px] font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5">
                      {item.unreadCount}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
