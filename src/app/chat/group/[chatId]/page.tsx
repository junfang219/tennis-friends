"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import Avatar from "@/components/Avatar";
import EmojiPicker from "@/components/EmojiPicker";
import SplitCostSheet from "@/components/SplitCostSheet";
import MessageReactionBar from "@/components/MessageReactionBar";
import MessageReactions, { type MessageReaction as MsgReaction } from "@/components/MessageReactions";
import { useLongPress } from "@/hooks/useLongPress";
import type { ReactionKey } from "@/lib/reactions";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  getChat,
  listChatMessages,
  listChatParticipants,
  sendChatMessage,
  addReaction,
} from "@/lib/supabase/queries";

type Message = {
  id: string;
  content: string;
  mediaUrl?: string;
  mediaType?: string;
  createdAt: string;
  senderId: string;
  sender: { id: string; name: string; profileImageUrl: string };
  reactions?: MsgReaction[];
};

type ChatInfo = {
  id: string;
  name: string;
  creatorId: string;
  participants: { id: string; name: string; profileImageUrl: string }[];
  guestNames: string[];
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

export default function GroupChatThreadPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInfo, setChatInfo] = useState<ChatInfo | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [showRename, setShowRename] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [showMembers, setShowMembers] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<{ url: string; type: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [reactionPopover, setReactionPopover] = useState<{ msgId: string; rect: DOMRect } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");
    setUploading(true);
    try {
      const isVideo = file.type.startsWith("video/");
      const sigRes = await fetch("/api/storage/sign-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bucket: "posts",
          filename: file.name,
          mimeType: file.type || (isVideo ? "video/mp4" : "image/jpeg"),
          sizeBytes: file.size,
        }),
      });
      if (!sigRes.ok) {
        const data = await sigRes.json().catch(() => ({}));
        setUploadError(data.error || "Upload failed");
      } else {
        const { signedUrl, publicUrl } = (await sigRes.json()) as {
          signedUrl: string;
          publicUrl: string;
        };
        const put = await fetch(signedUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!put.ok) {
          setUploadError("Upload failed");
        } else {
          setPendingMedia({ url: publicUrl, type: isVideo ? "video" : "image" });
        }
      }
    } catch {
      setUploadError("Upload failed. Try again.");
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const chatId = params.chatId as string;
  const myId = session?.user?.id || "";

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

  // Load chat metadata. Participants and the guest-names list both come
  // from separate sources: chat_participants (real users) and the chat's
  // own manual_player_names text column (comma-separated guest labels).
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    Promise.all([getChat(supabase, chatId), listChatParticipants(supabase, chatId)])
      .then(([c, participants]) => {
        if (!c) {
          setError("Chat not found.");
          return;
        }
        const next: ChatInfo = {
          id: c.id,
          name: c.name,
          creatorId: c.creator_id,
          participants: participants.map((p) => ({
            id: p.user.id,
            name: p.user.name,
            profileImageUrl: p.user.profile_image_url,
          })),
          guestNames: (c.manual_player_names || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        };
        setChatInfo(next);
      })
      .catch(() => setError("You are not a participant of this chat."));
  }, [chatId]);

  // Load messages
  const loadMessages = () => {
    const supabase = createSupabaseBrowserClient();
    listChatMessages(supabase, chatId)
      .then((rows) =>
        setMessages(
          rows.map((m) => ({
            id: m.id,
            content: m.content,
            mediaUrl: m.media_url,
            mediaType: m.media_type,
            createdAt: m.created_at,
            senderId: m.sender_id,
            sender: {
              id: m.sender.id,
              name: m.sender.name,
              profileImageUrl: m.sender.profile_image_url,
            },
            reactions: [],
          })) as unknown as Message[]
        )
      )
      .catch(() => {});
  };

  useEffect(() => {
    loadMessages();
    pollRef.current = setInterval(loadMessages, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleSend = async () => {
    if ((!input.trim() && !pendingMedia) || sending || uploading) return;
    setSending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const row = await sendChatMessage(supabase, chatId, input, {
        mediaUrl: pendingMedia?.url,
        mediaType: pendingMedia?.type,
      });
      const msg = {
        id: row.id,
        content: row.content,
        mediaUrl: row.media_url,
        mediaType: row.media_type,
        createdAt: row.created_at,
        senderId: row.sender_id,
        sender: {
          id: row.sender.id,
          name: row.sender.name,
          profileImageUrl: row.sender.profile_image_url,
        },
        reactions: [],
      } as unknown as Message;
      setMessages((prev) => [...prev, msg]);
      setInput("");
      setPendingMedia(null);
      inputRef.current?.focus();
    } catch {
      // ignore
    }
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const saveRename = async () => {
    const supabase = createSupabaseBrowserClient();
    const { error: upErr } = await supabase
      .from("chats")
      .update({ name: renameValue.trim() })
      .eq("id", chatId);
    if (!upErr && chatInfo) {
      setChatInfo({ ...chatInfo, name: renameValue.trim() });
      setShowRename(false);
    }
  };

  const leaveChat = async () => {
    if (!confirm("Leave this chat? You won't see new messages.")) return;
    const supabase = createSupabaseBrowserClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    // Soft-leave: hide the participant row for this user.
    const { error: hideErr } = await supabase
      .from("chat_participants")
      .update({ hidden_at: new Date().toISOString() })
      .eq("chat_id", chatId)
      .eq("user_id", auth.user.id);
    if (!hideErr) router.push("/friends");
  };

  const clearHistory = async () => {
    if (!confirm("Clear chat history? This only hides messages from your view; other members still see them.")) return;
    const supabase = createSupabaseBrowserClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { error: cErr } = await supabase
      .from("chat_participants")
      .update({ cleared_at: new Date().toISOString() })
      .eq("chat_id", chatId)
      .eq("user_id", auth.user.id);
    if (!cErr) {
      setMessages([]);
      loadMessages();
    }
  };

  const applyReaction = async (msgId: string, key: ReactionKey | null) => {
    if (!myId) return;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId) return m;
        const without = (m.reactions || []).filter((r) => r.userId !== myId);
        const next = key === null ? without : [...without, { emoji: key, userId: myId, userName: "You" }];
        return { ...m, reactions: next };
      }),
    );
    try {
      const supabase = createSupabaseBrowserClient();
      if (key !== null) await addReaction(supabase, "chat", msgId, key);
    } catch {
      // Polling will reconcile.
    }
  };

  const longPress = useLongPress((rect, target) => {
    const id = target.dataset.msgId;
    if (!id) return;
    setReactionPopover({ msgId: id, rect });
  });

  const popoverMsg = reactionPopover ? messages.find((m) => m.id === reactionPopover.msgId) : null;
  const popoverCurrent = (popoverMsg?.reactions || []).find((r) => r.userId === myId)?.emoji as ReactionKey | undefined;

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

  // Title: custom name OR comma-joined participant first names
  const title = chatInfo
    ? chatInfo.name ||
      chatInfo.participants
        .filter((p) => p.id !== myId)
        .map((p) => p.name.split(" ")[0])
        .join(", ") || "Group chat"
    : "";
  const others = chatInfo ? chatInfo.participants.filter((p) => p.id !== myId) : [];

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
    <div className="max-w-2xl mx-auto flex flex-col" style={{ height: "calc(100dvh - 4rem - env(safe-area-inset-top) - env(safe-area-inset-bottom))" }}>
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0">
        <button
          onClick={() => router.push("/friends")}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15,18 9,12 15,6" />
          </svg>
        </button>
        {chatInfo ? (
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Avatar stack — tap to see members */}
            <button
              onClick={() => setShowMembers(true)}
              className="flex -space-x-3 shrink-0 hover:opacity-80 transition-opacity"
              title="View members"
            >
              {others.slice(0, 3).map((p) => (
                <Avatar key={p.id} name={p.name} image={p.profileImageUrl} size="sm" />
              ))}
            </button>
            <div className="min-w-0 flex-1">
              {showRename ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    placeholder="Chat name"
                    className="flex-1 px-2 py-1 border border-gray-200 rounded-lg text-sm"
                    autoFocus
                  />
                  <button onClick={saveRename} className="text-xs font-semibold text-court-green">Save</button>
                  <button onClick={() => setShowRename(false)} className="text-xs text-gray-400">Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => { setRenameValue(chatInfo.name); setShowRename(true); }}
                  className="text-left w-full"
                >
                  <p className="text-sm font-semibold text-gray-900 truncate">{title}</p>
                  <p className="text-xs text-gray-400">{chatInfo.participants.length} members · tap to rename</p>
                </button>
              )}
            </div>
            <button
              onClick={() => setShowSplit(true)}
              className="text-xs font-medium text-court-green hover:text-court-green-light px-2 py-1"
              title="Split a cost"
            >
              💵 Split
            </button>
            <button
              onClick={clearHistory}
              className="text-xs font-medium text-gray-500 hover:text-gray-700 px-2 py-1"
              title="Clear chat history (your view only)"
            >
              Clear
            </button>
            <button
              onClick={leaveChat}
              className="text-xs font-medium text-red-500 hover:text-red-700 px-2 py-1"
              title="Leave chat"
            >
              Leave
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-1">
            <div className="skeleton w-10 h-10 rounded-xl" />
            <div className="skeleton w-32 h-4" />
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 bg-surface/50 net-texture">
        {messages.length === 0 && chatInfo && (
          <div className="text-center py-16">
            <div className="flex -space-x-3 justify-center">
              {others.slice(0, 3).map((p) => (
                <Avatar key={p.id} name={p.name} image={p.profileImageUrl} size="lg" />
              ))}
            </div>
            <h3 className="font-display text-lg font-bold text-gray-800 mt-4 mb-1">
              {title}
            </h3>
            <p className="text-sm text-gray-400">
              No messages yet. Say hi!
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
              const isMe = msg.senderId === myId;
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

                  <div
                    className="max-w-[75%] select-none"
                    data-msg-id={msg.id}
                    data-long-press-root
                    style={{ touchAction: "pan-y" }}
                    {...longPress}
                  >
                    {showName && (
                      <p className="text-[11px] font-medium text-court-green-soft ml-1 mb-0.5">
                        {msg.sender.name}
                      </p>
                    )}
                    {msg.mediaUrl && (
                      <div className={`rounded-2xl overflow-hidden shadow-sm ${isMe ? "ml-auto" : ""}`}>
                        {msg.mediaType === "video" ? (
                          <video src={`${msg.mediaUrl}#t=0.1`} controls preload="metadata" playsInline className="max-w-full max-h-80 bg-black" />
                        ) : (
                          <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer">
                            <img src={msg.mediaUrl} alt="" className="max-w-full max-h-80 object-cover" />
                          </a>
                        )}
                      </div>
                    )}
                    {msg.content && (
                      <div
                        className={`px-4 py-2.5 text-sm leading-relaxed ${msg.mediaUrl ? "mt-1 " : ""}${
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
                    )}
                    {msg.mediaUrl && !msg.content && (
                      <p className={`text-[10px] mt-1 ${isMe ? "text-right" : ""} text-gray-400`}>
                        {formatTime(msg.createdAt)}
                      </p>
                    )}
                    {msg.reactions && msg.reactions.length > 0 && (
                      <MessageReactions
                        reactions={msg.reactions}
                        myUserId={myId}
                        align={isMe ? "right" : "left"}
                        onToggle={(emojiKey) => {
                          const mine = (msg.reactions || []).find((r) => r.userId === myId)?.emoji;
                          applyReaction(msg.id, mine === emojiKey ? null : (emojiKey as ReactionKey));
                        }}
                      />
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
        {pendingMedia && (
          <div className="mb-2 inline-flex items-start gap-2 bg-gray-100 rounded-xl p-2">
            {pendingMedia.type === "image" ? (
              <img src={pendingMedia.url} alt="" className="w-20 h-20 object-cover rounded-lg" />
            ) : (
              <video src={`${pendingMedia.url}#t=0.1`} preload="metadata" playsInline muted className="w-20 h-20 object-cover rounded-lg bg-black" />
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
            placeholder={`Message ${title || "group"}...`}
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-full text-sm bg-surface/50 focus:bg-white transition-colors"
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

      {/* Members modal */}
      {showMembers && chatInfo && (
        <div
          className="fixed inset-0 z-[999] bg-black/50 flex items-center justify-center p-4"
          onClick={() => setShowMembers(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-bold text-gray-800">Members</h3>
                <p className="text-xs text-gray-400">
                  {chatInfo.participants.length} in this chat
                  {chatInfo.guestNames.length > 0 && ` · ${chatInfo.guestNames.length} guest${chatInfo.guestNames.length === 1 ? "" : "s"}`}
                </p>
              </div>
              <button
                onClick={() => setShowMembers(false)}
                className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {chatInfo.participants.map((p) => {
                const isMe = p.id === myId;
                const isCreator = p.id === chatInfo.creatorId;
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      setShowMembers(false);
                      if (!isMe) router.push(`/profile/${p.id}`);
                    }}
                    className="w-full flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors text-left"
                  >
                    <Avatar name={p.name} image={p.profileImageUrl} size="md" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {p.name}{isMe ? " (You)" : ""}
                        </p>
                        {isCreator && (
                          <span className="text-[10px] font-bold text-court-green bg-court-green-pale/30 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                            Creator
                          </span>
                        )}
                      </div>
                      {!isMe && (
                        <p className="text-xs text-gray-400">Tap to view profile</p>
                      )}
                    </div>
                  </button>
                );
              })}
              {chatInfo.guestNames.length > 0 && (
                <div className="border-t border-gray-100">
                  <p className="px-5 pt-3 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    Guests · not on Tennis Friends
                  </p>
                  {chatInfo.guestNames.map((g, i) => (
                    <div key={`guest-${i}`} className="flex items-center gap-3 px-5 py-3">
                      <Avatar name={g} image="" size="md" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-gray-700 truncate">{g}</p>
                          <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                            Guest
                          </span>
                        </div>
                        <p className="text-xs text-gray-400">Counts toward split costs · pay in person</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {showSplit && chatInfo && (
        <SplitCostSheet
          chatId={chatId}
          participants={chatInfo.participants}
          guestNames={chatInfo.guestNames}
          myId={myId}
          onClose={() => setShowSplit(false)}
          onExpenseCreated={loadMessages}
        />
      )}

      <MessageReactionBar
        anchorRect={reactionPopover?.rect ?? null}
        currentReaction={popoverCurrent ?? null}
        onSelect={(key) => {
          if (reactionPopover) applyReaction(reactionPopover.msgId, key);
          setReactionPopover(null);
        }}
        onClose={() => setReactionPopover(null)}
      />
    </div>
  );
}
