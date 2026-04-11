"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import PostCard from "@/components/PostCard";
import EmojiPicker from "@/components/EmojiPicker";

type SharedPost = {
  id: string;
  content: string;
  mediaUrl: string;
  mediaType: string;
  postType: string;
  playDate: string;
  playTime: string;
  courtLocation: string;
  gameType: string;
  playersNeeded: number;
  playersConfirmed: number;
  courtBooked: boolean;
  isComplete: boolean;
  author: { id: string; name: string; profileImageUrl: string };
};

type Message = {
  id: string;
  content: string;
  mediaUrl?: string;
  mediaType?: string;
  createdAt: string;
  senderId: string;
  sharedPostId?: string | null;
  sharedPost?: SharedPost | null;
  sender: { id: string; name: string; profileImageUrl: string };
};

type ChatUser = {
  id: string;
  name: string;
  profileImageUrl: string;
  skillLevel: string;
};

function formatTime(date: string) {
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateSeparator(date: string) {
  const d = new Date(date);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function ChatPage() {
  const params = useParams();
  const { data: session } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatUser, setChatUser] = useState<ChatUser | null>(null);
  const [input, setInput] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<{ url: string; type: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setUploadError(data.error || "Upload failed");
      } else {
        const data = await res.json();
        setPendingMedia({ url: data.url, type: data.mediaType });
      }
    } catch {
      setUploadError("Upload failed. Try again.");
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    if (!el) {
      setInput((prev) => prev + emoji);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + emoji + el.value.slice(end);
    setInput(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const userId = params.userId as string;

  // Load chat user info
  useEffect(() => {
    fetch(`/api/users/${userId}`)
      .then((r) => r.json())
      .then((data) => setChatUser(data));
  }, [userId]);

  // Load messages
  const loadMessages = () => {
    fetch(`/api/messages?with=${userId}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setMessages(data);
      });
  };

  const markRead = () => {
    fetch("/api/messages/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otherId: userId }),
    }).catch(() => {});
  };

  useEffect(() => {
    loadMessages();
    markRead();
    // Poll for new messages every 3 seconds; bump read on each poll so the badge clears
    pollRef.current = setInterval(() => {
      loadMessages();
      markRead();
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleSend = async () => {
    if ((!input.trim() && !pendingMedia) || sending || uploading) return;
    setSending(true);

    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        receiverId: userId,
        content: input,
        mediaUrl: pendingMedia?.url,
        mediaType: pendingMedia?.type,
      }),
    });

    if (res.ok) {
      const msg = await res.json();
      setMessages((prev) => [...prev, msg]);
      setInput("");
      setPendingMedia(null);
      inputRef.current?.focus();
    }
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearHistory = async () => {
    if (!confirm("Clear chat history? This only hides messages from your view; the other person still sees them.")) return;
    const res = await fetch("/api/inbox/state", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "direct", id: userId, action: "clear" }),
    });
    if (res.ok) {
      setMessages([]);
      loadMessages();
    }
  };

  // Group messages by date
  const messagesByDate: { date: string; messages: Message[] }[] = [];
  messages.forEach((msg) => {
    const dateStr = new Date(msg.createdAt).toDateString();
    const last = messagesByDate[messagesByDate.length - 1];
    if (last && last.date === dateStr) {
      last.messages.push(msg);
    } else {
      messagesByDate.push({ date: dateStr, messages: [msg] });
    }
  });

  return (
    <div className="max-w-2xl mx-auto flex flex-col" style={{ height: "calc(100vh - 4rem)" }}>
      {/* Chat header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0">
        <Link
          href="/friends"
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15,18 9,12 15,6" />
          </svg>
        </Link>
        {chatUser ? (
          <>
            <Link href={`/profile/${chatUser.id}`} className="flex items-center gap-3 flex-1 min-w-0">
              <Avatar name={chatUser.name} image={chatUser.profileImageUrl} size="md" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{chatUser.name}</p>
                <p className="text-xs text-court-green-soft">Tennis Friend</p>
              </div>
            </Link>
            <button
              onClick={clearHistory}
              className="text-xs font-medium text-gray-500 hover:text-gray-700 px-2 py-1"
              title="Clear chat history (your view only)"
            >
              Clear
            </button>
          </>
        ) : (
          <div className="flex items-center gap-3 flex-1">
            <div className="skeleton w-10 h-10 rounded-full" />
            <div className="skeleton w-32 h-4" />
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 bg-surface/50 net-texture">
        {messages.length === 0 && chatUser && (
          <div className="text-center py-16">
            <Avatar name={chatUser.name} image={chatUser.profileImageUrl} size="xl" />
            <h3 className="font-display text-lg font-bold text-gray-800 mt-4 mb-1">
              {chatUser.name}
            </h3>
            <p className="text-sm text-gray-400">
              Start the conversation! Say hello to your tennis friend.
            </p>
          </div>
        )}

        {messagesByDate.map((group) => (
          <div key={group.date}>
            {/* Date separator */}
            <div className="flex items-center justify-center my-4">
              <span className="text-xs font-medium text-gray-400 bg-white/80 px-3 py-1 rounded-full shadow-sm">
                {formatDateSeparator(group.messages[0].createdAt)}
              </span>
            </div>

            {group.messages.map((msg, i) => {
              const isMe = msg.senderId === session?.user?.id;
              const prevMsg = i > 0 ? group.messages[i - 1] : null;
              const sameSender = prevMsg?.senderId === msg.senderId;
              const showAvatar = !isMe && !sameSender;

              return (
                <div
                  key={msg.id}
                  className={`flex items-end gap-2 ${isMe ? "justify-end" : "justify-start"} ${sameSender ? "mt-0.5" : "mt-3"}`}
                >
                  {/* Other user avatar */}
                  {!isMe && (
                    <div className="w-7 shrink-0">
                      {showAvatar && (
                        <Avatar name={msg.sender.name} image={msg.sender.profileImageUrl} size="sm" />
                      )}
                    </div>
                  )}

                  <div className="max-w-[75%]">
                    {/* Shared post card */}
                    {msg.sharedPost && (
                      <SharedPostCard post={msg.sharedPost} />
                    )}

                    {/* Media attachment */}
                    {msg.mediaUrl && (
                      <div className={`rounded-2xl overflow-hidden shadow-sm ${msg.sharedPost ? "mt-1" : ""} ${isMe ? "ml-auto" : ""}`}>
                        {msg.mediaType === "video" ? (
                          <video src={msg.mediaUrl} controls className="max-w-full max-h-80 bg-black" />
                        ) : (
                          <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer">
                            <img src={msg.mediaUrl} alt="" className="max-w-full max-h-80 object-cover" />
                          </a>
                        )}
                      </div>
                    )}

                    {/* Text message bubble */}
                    {(msg.content || (!msg.sharedPost && !msg.mediaUrl)) && (
                      <div
                        className={`px-4 py-2.5 text-sm leading-relaxed ${msg.sharedPost || msg.mediaUrl ? "mt-1 " : ""}${
                          isMe
                            ? "bg-court-green text-white rounded-2xl rounded-br-md"
                            : "bg-white text-gray-800 rounded-2xl rounded-bl-md shadow-sm border border-gray-100"
                        }`}
                      >
                        {msg.content && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
                        {!msg.content && msg.sharedPost && <p className="whitespace-pre-wrap break-words opacity-70">Shared a post</p>}
                        <p className={`text-[10px] mt-1 ${isMe ? "text-white/60" : "text-gray-400"}`}>
                          {formatTime(msg.createdAt)}
                        </p>
                      </div>
                    )}
                    {/* Timestamp under media-only messages */}
                    {msg.mediaUrl && !msg.content && !msg.sharedPost && (
                      <p className={`text-[10px] mt-1 ${isMe ? "text-right text-gray-400" : "text-gray-400"}`}>
                        {formatTime(msg.createdAt)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="bg-white border-t border-gray-200 px-4 py-3 shrink-0">
        {/* Pending media preview */}
        {pendingMedia && (
          <div className="mb-2 inline-flex items-start gap-2 bg-gray-100 rounded-xl p-2">
            {pendingMedia.type === "image" ? (
              <img src={pendingMedia.url} alt="" className="w-20 h-20 object-cover rounded-lg" />
            ) : (
              <video src={pendingMedia.url} className="w-20 h-20 object-cover rounded-lg bg-black" />
            )}
            <button
              onClick={() => setPendingMedia(null)}
              className="w-6 h-6 rounded-full bg-gray-700 hover:bg-gray-900 text-white flex items-center justify-center"
              aria-label="Remove attachment"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}
        {uploadError && <p className="text-xs text-red-500 mb-2">{uploadError}</p>}
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,video/mov"
            onChange={handleFileSelect}
            disabled={uploading}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-10 h-10 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700 flex items-center justify-center transition-colors disabled:opacity-40 shrink-0"
            title="Attach photo or video"
          >
            {uploading ? (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            )}
          </button>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-full text-sm bg-surface/50 focus:bg-white transition-colors"
            autoFocus
          />
          <EmojiPicker open={emojiOpen} onOpenChange={setEmojiOpen} onSelect={insertEmoji} />
          <button
            onClick={handleSend}
            disabled={(!input.trim() && !pendingMedia) || sending || uploading}
            className="w-10 h-10 rounded-full bg-court-green text-white flex items-center justify-center hover:bg-court-green-light transition-colors disabled:opacity-40 disabled:hover:bg-court-green shrink-0"
          >
            {sending ? (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22,2 15,22 11,13 2,9" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function SharedPostCard({ post }: { post: SharedPost }) {
  const [showFullPost, setShowFullPost] = useState(false);
  const [fullPostData, setFullPostData] = useState<Record<string, unknown> | null>(null);
  const [loadingPost, setLoadingPost] = useState(false);
  const isFindPlayers = post.postType === "find_players";

  const openFullPost = async () => {
    setShowFullPost(true);
    if (!fullPostData) {
      setLoadingPost(true);
      const res = await fetch(`/api/posts/${post.id}`);
      if (res.ok) {
        const data = await res.json();
        setFullPostData(data);
      }
      setLoadingPost(false);
    }
  };

  return (
    <>
      <button onClick={openFullPost} className="text-left bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden max-w-full hover:shadow-md transition-shadow w-full">
        {/* Author */}
        <div className="px-3 pt-3 pb-2 flex items-center gap-2">
          <Avatar name={post.author.name} image={post.author.profileImageUrl} size="sm" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-900 truncate">{post.author.name}</p>
            {isFindPlayers && (
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase ${post.isComplete ? "bg-green-100 text-green-700" : "bg-court-green text-ball-yellow"}`}>
                {post.isComplete ? "Game Full" : "Looking for Players"}
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        {post.content && (
          <p className="px-3 pb-2 text-xs text-gray-700 line-clamp-3">{post.content}</p>
        )}

        {/* Media thumbnail */}
        {post.mediaUrl && post.mediaType === "image" && (
          <img src={post.mediaUrl} alt="Post" className="w-full max-h-40 object-cover" />
        )}

        {/* Find Players summary */}
        {isFindPlayers && (
          <div className="px-3 py-2 bg-court-green/5 border-t border-gray-100">
            <div className="flex items-center gap-3 text-[11px] text-gray-600">
              {post.playDate && <span>{post.playDate}</span>}
              {post.playTime && <span>{post.playTime}</span>}
              {post.courtLocation && <span className="truncate">{post.courtLocation}</span>}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[11px] text-gray-500 capitalize">{post.gameType}</span>
              <span className="text-[11px] text-gray-500">{post.playersConfirmed}/{post.playersNeeded} players</span>
            </div>
          </div>
        )}

        {/* Tap to open hint */}
        <div className="px-3 py-1.5 border-t border-gray-100 text-center">
          <span className="text-[10px] text-gray-400 font-medium">Tap to open post</span>
        </div>
      </button>

      {/* Full post modal */}
      {showFullPost && createPortal(
        <div
          className="fixed inset-0 z-[999] bg-black/50 flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
          onClick={() => setShowFullPost(false)}
        >
          <div
            className="w-full sm:max-w-lg sm:my-8"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <div className="flex justify-end mb-2 px-2 sm:px-0">
              <button
                onClick={() => setShowFullPost(false)}
                className="w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {loadingPost ? (
              <div className="bg-white rounded-2xl p-8 text-center">
                <svg className="animate-spin w-6 h-6 text-court-green mx-auto" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                  <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </div>
            ) : fullPostData ? (
              <PostCard post={fullPostData as Parameters<typeof PostCard>[0]["post"]} />
            ) : (
              <div className="bg-white rounded-2xl p-8 text-center">
                <p className="text-gray-500 text-sm">Post not found</p>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
