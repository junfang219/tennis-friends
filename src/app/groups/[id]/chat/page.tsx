"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import Avatar from "@/components/Avatar";

type Message = {
  id: string;
  content: string;
  createdAt: string;
  senderId: string;
  sender: { id: string; name: string; profileImageUrl: string };
};

type GroupInfo = {
  id: string;
  name: string;
  _count: { members: number };
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

export default function GroupChatPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [groupInfo, setGroupInfo] = useState<GroupInfo | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const groupId = params.id as string;

  // Load group info
  useEffect(() => {
    fetch(`/api/groups/${groupId}`)
      .then((r) => {
        if (r.status === 403) { setError("You are not a member of this group."); return null; }
        if (!r.ok) { setError("Group not found."); return null; }
        return r.json();
      })
      .then((data) => { if (data) setGroupInfo(data); });
  }, [groupId]);

  // Load messages
  const loadMessages = () => {
    fetch(`/api/groups/${groupId}/messages`)
      .then((r) => {
        if (!r.ok) return;
        return r.json();
      })
      .then((data) => { if (Array.isArray(data)) setMessages(data); });
  };

  useEffect(() => {
    loadMessages();
    pollRef.current = setInterval(loadMessages, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    setSending(true);

    const res = await fetch(`/api/groups/${groupId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: input }),
    });

    if (res.ok) {
      const msg = await res.json();
      setMessages((prev) => [...prev, msg]);
      setInput("");
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

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </div>
        <p className="text-gray-500">{error}</p>
        <button onClick={() => router.back()} className="btn-primary mt-4">Go Back</button>
      </div>
    );
  }

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
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0">
        <Link
          href={`/groups/${groupId}`}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15,18 9,12 15,6" />
          </svg>
        </Link>
        {groupInfo ? (
          <Link href={`/groups/${groupId}`} className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-court-green to-court-green-soft flex items-center justify-center text-white font-bold text-sm shadow-md shrink-0">
              {groupInfo.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{groupInfo.name}</p>
              <p className="text-xs text-gray-400">{groupInfo._count.members} members</p>
            </div>
          </Link>
        ) : (
          <div className="flex items-center gap-3 flex-1">
            <div className="skeleton w-10 h-10 rounded-xl" />
            <div className="skeleton w-32 h-4" />
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 bg-surface/50 net-texture">
        {messages.length === 0 && groupInfo && (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-court-green to-court-green-soft flex items-center justify-center text-white font-bold text-2xl mx-auto shadow-lg">
              {groupInfo.name.charAt(0).toUpperCase()}
            </div>
            <h3 className="font-display text-lg font-bold text-gray-800 mt-4 mb-1">
              {groupInfo.name}
            </h3>
            <p className="text-sm text-gray-400">
              No messages yet. Start the group conversation!
            </p>
          </div>
        )}

        {messagesByDate.map((group) => (
          <div key={group.date}>
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
              const showName = !isMe && !sameSender;

              return (
                <div
                  key={msg.id}
                  className={`flex items-end gap-2 ${isMe ? "justify-end" : "justify-start"} ${sameSender ? "mt-0.5" : "mt-3"}`}
                >
                  {!isMe && (
                    <div className="w-7 shrink-0">
                      {showAvatar && (
                        <Avatar name={msg.sender.name} image={msg.sender.profileImageUrl} size="sm" />
                      )}
                    </div>
                  )}

                  <div className={`max-w-[75%] ${isMe ? "" : ""}`}>
                    {showName && (
                      <p className="text-[11px] font-medium text-court-green-soft ml-1 mb-0.5">
                        {msg.sender.name}
                      </p>
                    )}
                    <div
                      className={`px-4 py-2.5 text-sm leading-relaxed ${
                        isMe
                          ? "bg-court-green text-white rounded-2xl rounded-br-md"
                          : "bg-white text-gray-800 rounded-2xl rounded-bl-md shadow-sm border border-gray-100"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                      <p className={`text-[10px] mt-1 ${isMe ? "text-white/60" : "text-gray-400"}`}>
                        {formatTime(msg.createdAt)}
                      </p>
                    </div>
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
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${groupInfo?.name || "group"}...`}
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-full text-sm bg-surface/50 focus:bg-white transition-colors"
            autoFocus
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
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
