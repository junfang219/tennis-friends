"use client";

import { useEffect, useLayoutEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useParams, useSearchParams } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import EmojiPicker from "@/components/EmojiPicker";
import SharedPostCard, { type SharedPost } from "@/components/SharedPostCard";
import MessageReactionBar from "@/components/MessageReactionBar";
import MessageReactions, { type MessageReaction as MsgReaction } from "@/components/MessageReactions";
import { useLongPress } from "@/hooks/useLongPress";
import { useKeyboardHeight } from "@/hooks/useKeyboardHeight";
import type { ReactionKey } from "@/lib/reactions";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useRealtimeTable } from "@/lib/supabase/realtime";
import {
  getProfile,
  listDirectMessages,
  markDmRead,
  sendDirectMessage,
  deleteDirectMessage,
  addReaction,
  removeReaction,
  listReactionsForMessages,
} from "@/lib/supabase/queries";
import { uploadToBucket, isUploadError } from "@/lib/supabase/upload";
import { toDirectMessageCamel } from "@/lib/supabase/adapters";

// Page Message is the shared DirectMessageCamel adapter (snake→camel +
// pgToIso) plus the per-message reactions list and the resolved shared
// post object. sharedPostId comes from the adapter; sharedPost is filled
// in by the caller when it has the post body to embed.
type Message = ReturnType<typeof toDirectMessageCamel> & {
  sharedPost?: SharedPost | null;
  reactions?: MsgReaction[];
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
  const [sendError, setSendError] = useState("");
  const [pendingMedia, setPendingMedia] = useState<{ url: string; type: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [reactionPopover, setReactionPopover] = useState<{ msgId: string; rect: DOMRect } | null>(null);
  const searchParams = useSearchParams();
  // Read the deep-link target once on mount (e.g. /chat/<id>?msg=<msgId> from a
  // tapped notification). useRef-with-initial-value snapshots the param so
  // later renders don't keep re-triggering the focus effect.
  const focusTargetRef = useRef<string | null>(searchParams.get("msg"));
  // Track resolution as a ref (not state) so flipping it does NOT re-fire the
  // bottom-scroll effect — that race was scrolling us past the centered bubble.
  const focusHandledRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const inputBarRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keyboard height in px (0 when closed). Capacitor events on native,
  // visualViewport on web. See chat/group/[chatId]/page.tsx + the
  // useKeyboardHeight hook for the full design rationale.
  const keyboardHeight = useKeyboardHeight();

  const [inputBarHeight, setInputBarHeight] = useState(72);
  useLayoutEffect(() => {
    const el = inputBarRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const h = e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height;
        if (h > 0) setInputBarHeight(h);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Lock body scroll while the chat thread is mounted so iOS bounce /
  // pull-to-refresh doesn't drag the page around behind the fixed surface.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.overscrollBehavior = prevOverscroll;
    };
  }, []);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");
    setUploading(true);
    try {
      const upResult = await uploadToBucket(file, "posts");
      if (isUploadError(upResult)) {
        setUploadError(upResult.message);
      } else {
        setPendingMedia({ url: upResult.url, type: upResult.mediaType });
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
    const supabase = createSupabaseBrowserClient();
    getProfile(supabase, userId).then((p) => {
      if (p) {
        setChatUser({
          id: p.id,
          name: p.name,
          profileImageUrl: p.profile_image_url,
          skillLevel: p.skill_level,
        });
      }
    });
  }, [userId]);

  // Load messages. Reactions live in a sibling table (message_reactions)
  // so fetch them in parallel and zip them onto each row, keyed by message id.
  // Without this the 3s poll would wipe any optimistic emoji because the
  // page state would otherwise reset reactions to [] on every refresh.
  const loadMessages = async () => {
    const supabase = createSupabaseBrowserClient();
    const rows = await listDirectMessages(supabase, userId);
    const reactionRows = rows.length
      ? await listReactionsForMessages(supabase, "dm", rows.map((m) => m.id)).catch(() => [])
      : [];
    const byMessage = new Map<string, MsgReaction[]>();
    for (const r of reactionRows) {
      const arr = byMessage.get(r.target_id) ?? [];
      arr.push({ emoji: r.emoji, userId: r.user_id, userName: r.user.name });
      byMessage.set(r.target_id, arr);
    }
    const fresh: Message[] = rows.map((m) => ({
      ...toDirectMessageCamel(m),
      sharedPost: null,
      reactions: byMessage.get(m.id) ?? [],
    }));
    // Preserve optimistic bubbles whose await sendDirectMessage hasn't
    // resolved yet — without this the poll briefly flickers the just-sent
    // message off-screen between the optimistic insert and the swap-in.
    setMessages((prev) => {
      const pending = prev.filter((m) => m.id.startsWith("temp-"));
      return pending.length ? [...fresh, ...pending] : fresh;
    });
  };

  const markRead = () => {
    const supabase = createSupabaseBrowserClient();
    void markDmRead(supabase, userId).catch(() => {});
  };

  useEffect(() => {
    loadMessages();
    markRead();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Realtime: refetch + mark-read when the other user sends us a message.
  // RLS already scopes the channel to messages we can read; we filter on
  // receiver_id (us) and then check the sender so unrelated DMs don't
  // trigger spurious refetches. Outgoing messages and reactions stream
  // in via their own optimistic paths.
  const me = session?.user?.id;
  useRealtimeTable(
    {
      table: "messages",
      event: "INSERT",
      filter: me ? `receiver_id=eq.${me}` : undefined,
      onChange: (payload) => {
        const row = payload.new as { sender_id?: string } | null;
        if (!row || row.sender_id !== userId) return;
        loadMessages();
        markRead();
      },
    },
    [userId, me]
  );

  // Scroll to bottom on new messages — but skip the *initial* load when a
  // deep-link target is set, so we land in the middle of the thread instead
  // of bouncing past it. After the target is centered, future arrivals scroll
  // to bottom as usual.
  // Split scroll-to-bottom into two effects so the keyboard trigger
  // doesn't get incorrectly suppressed by the "near bottom" guard.
  // See chat/group/[chatId]/page.tsx for the full rationale.
  const isInitialPinRef = useRef(true);
  useEffect(() => {
    isInitialPinRef.current = true;
  }, [userId]);

  // (1) Keyboard / input-bar change — always pin.
  useEffect(() => {
    if (focusTargetRef.current && !focusHandledRef.current) return;
    const el = messagesScrollRef.current;
    if (!el) return;
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        const sc = messagesScrollRef.current;
        if (sc) sc.scrollTop = sc.scrollHeight;
      });
      (el as HTMLDivElement & { _raf2?: number })._raf2 = raf2;
    });
    return () => {
      cancelAnimationFrame(raf1);
      const stashed = (el as HTMLDivElement & { _raf2?: number })._raf2;
      if (stashed !== undefined) cancelAnimationFrame(stashed);
    };
  }, [keyboardHeight, inputBarHeight, userId]);

  // (2) Messages change — pin only if user was near the bottom (80px).
  useEffect(() => {
    if (focusTargetRef.current && !focusHandledRef.current) return;
    const el = messagesScrollRef.current;
    if (!el) return;
    const initial = isInitialPinRef.current;
    if (!initial) {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distanceFromBottom > 80 && messages.length > 0) return;
    }
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        const sc = messagesScrollRef.current;
        if (!sc) return;
        sc.scrollTop = sc.scrollHeight;
        if (sc.clientHeight > 0 && sc.scrollHeight > 0) {
          isInitialPinRef.current = false;
        }
      });
      (el as HTMLDivElement & { _raf2?: number })._raf2 = raf2;
    });
    return () => {
      cancelAnimationFrame(raf1);
      const stashed = (el as HTMLDivElement & { _raf2?: number })._raf2;
      if (stashed !== undefined) cancelAnimationFrame(stashed);
    };
  }, [messages.length]);

  // Pin to bottom the first time the scroll container actually gets a
  // real height — catches the case where the initial effect ran while
  // clientHeight was still 0 (Suspense boundary / portal mount race).
  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let firedOnce = false;
    const ro = new ResizeObserver(() => {
      if (firedOnce) return;
      if (el.clientHeight > 0 && el.scrollHeight > 0) {
        firedOnce = true;
        el.scrollTop = el.scrollHeight;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [userId]);

  // Deep-link: scroll to and briefly highlight the message referenced by ?msg=…
  useEffect(() => {
    const targetId = focusTargetRef.current;
    if (!targetId || focusHandledRef.current) return;
    if (!messages.some((m) => m.id === targetId)) return;
    // requestAnimationFrame so the bubble is laid out before measuring/scrolling.
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`msg-${targetId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-4", "ring-amber-300", "ring-offset-2", "ring-offset-transparent", "rounded-2xl");
      setTimeout(() => {
        el.classList.remove("ring-4", "ring-amber-300", "ring-offset-2", "ring-offset-transparent", "rounded-2xl");
      }, 1800);
      focusHandledRef.current = true;
    });
    return () => cancelAnimationFrame(raf);
  }, [messages]);

  const handleSend = async () => {
    if ((!input.trim() && !pendingMedia) || sending || uploading) return;
    setSending(true);

    // Optimistic: render the bubble + clear the input immediately so the
    // UI doesn't wait on the Supabase round-trip (200–500ms on real
    // hardware). On success, swap the temp row for the server's id and
    // canonical timestamp. On failure, roll back and put the text back
    // into the input so the user doesn't lose their message.
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const draftContent = input;
    const draftMedia = pendingMedia;
    const optimistic: Message = {
      id: tempId,
      content: draftContent,
      mediaUrl: draftMedia?.url ?? "",
      mediaType: draftMedia?.type ?? "",
      createdAt: new Date().toISOString(),
      senderId: myId,
      receiverId: userId,
      sharedPostId: null,
      sharedPost: null,
      reactions: [],
    };
    setMessages((prev) => [...prev, optimistic]);
    // Defer the input clear by one microtask. Inside the synchronous
    // click/keydown handler, changing the focused input's value can
    // make iOS WKWebView briefly dismiss and re-present the keyboard
    // (the "bounce") even when focus is retained. The group-chat
    // handleSend doesn't hit this because its setInput runs *after*
    // an await (already in a microtask); the 1:1 handler clears
    // synchronously for optimistic UX, so we push the clear out by
    // one microtask ourselves. <1ms delay — imperceptible to the user.
    queueMicrotask(() => {
      setInput("");
      setPendingMedia(null);
    });
    // Intentionally NOT calling inputRef.current?.focus() — see
    // chat/group/[chatId]/page.tsx for full rationale. Calling focus()
    // on an already-focused input on iOS WKWebView bounces the keyboard.

    try {
      const supabase = createSupabaseBrowserClient();
      const row = await sendDirectMessage(supabase, userId, draftContent, {
        mediaUrl: draftMedia?.url,
        mediaType: draftMedia?.type,
      });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId
            ? { ...toDirectMessageCamel(row), sharedPost: null, reactions: [] }
            : m,
        ),
      );
    } catch (err) {
      // Roll back the optimistic bubble + restore the draft so the user
      // can retry. Don't restore pendingMedia — it's already uploaded and
      // re-attaching it would re-upload on the next send.
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInput(draftContent);
      setSendError(err instanceof Error ? err.message : "Couldn't send.");
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
    // direct_message_reads.cleared_at acts as the per-user soft-clear.
    const supabase = createSupabaseBrowserClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { error } = await supabase.from("direct_message_reads").upsert(
      {
        user_id: auth.user.id,
        other_id: userId,
        cleared_at: new Date().toISOString(),
        last_read_at: new Date().toISOString(),
      },
      { onConflict: "user_id,other_id" }
    );
    if (!error) {
      setMessages([]);
      loadMessages();
    }
  };

  const myId = session?.user?.id || "";

  const applyReaction = async (msgId: string, key: ReactionKey | null) => {
    if (!myId) return;
    // Snapshot the user's existing reaction so we know what to delete on
    // a swap or toggle-off. The bar only emits "switch" / "toggle off",
    // never "same emoji again" (it toggles off in that case), so the
    // delete-then-add ordering below covers every reachable transition.
    const prevEmoji = messages
      .find((m) => m.id === msgId)
      ?.reactions?.find((r) => r.userId === myId)?.emoji as ReactionKey | undefined;

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
      if (prevEmoji && prevEmoji !== key) {
        await removeReaction(supabase, "dm", msgId, prevEmoji);
      }
      if (key !== null && prevEmoji !== key) {
        await addReaction(supabase, "dm", msgId, key);
      }
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
  const popoverIsMine = !!popoverMsg && popoverMsg.senderId === myId;

  const deleteMessage = async (msgId: string) => {
    const snapshot = messages;
    // Optimistic remove; RLS blocks anyone but the sender so a failure
    // here is a real error (network, deleted-twice race) rather than a
    // permission issue we should silently absorb.
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
    try {
      const supabase = createSupabaseBrowserClient();
      await deleteDirectMessage(supabase, msgId);
    } catch {
      setMessages(snapshot);
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

  if (!mounted) return null;

  // Portaled fixed full-viewport chat surface — see
  // chat/group/[chatId]/page.tsx for full rationale. The portal under
  // <body> bypasses any ancestor that might create a containing block
  // (transform / filter / contain) and break `position: fixed`.
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-surface">
      {/* Chat header */}
      <div
        className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0"
        style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top))" }}
      >
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

      {/*
        Messages — the only scrolling region. min-h-0 lets flex shrink
        it below content height. paddingBottom reserves room for the
        absolutely-positioned input bar plus the keyboard plus the
        home indicator inset.
      */}
      <div
        ref={messagesScrollRef}
        className="flex-1 overflow-y-auto min-h-0 px-4 py-4 bg-surface/50 net-texture"
        style={{
          paddingBottom: `calc(${inputBarHeight}px + max(${keyboardHeight}px, env(safe-area-inset-bottom)) + 0.5rem)`,
        }}
      >
        {/* min-h-full + justify-end pins short threads to the bottom of
            the scroll region so a just-sent bubble lands right above
            the input bar instead of floating at the top. Long threads
            outgrow min-h-full and scroll normally. */}
        <div className="min-h-full flex flex-col justify-end">
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
                  {/* Other user avatar — 1:1 chat, so the non-me sender is
                      always chatUser. Sourcing from chatUser avoids fetching
                      sender profile data per message. */}
                  {!isMe && (
                    <div className="w-7 shrink-0">
                      {showAvatar && chatUser && (
                        <Avatar name={chatUser.name} image={chatUser.profileImageUrl} size="sm" />
                      )}
                    </div>
                  )}

                  <div
                    id={`msg-${msg.id}`}
                    className="max-w-[75%] select-none sm:select-text transition-shadow"
                    data-msg-id={msg.id}
                    data-long-press-root
                    style={{ touchAction: "pan-y" }}
                    {...longPress}
                  >
                    {/* Shared post card */}
                    {msg.sharedPost && (
                      <SharedPostCard post={msg.sharedPost} />
                    )}

                    {/* Media attachment */}
                    {msg.mediaUrl && (
                      <div className={`rounded-2xl overflow-hidden shadow-sm ${msg.sharedPost ? "mt-1" : ""} ${isMe ? "ml-auto" : ""}`}>
                        {msg.mediaType === "video" ? (
                          <video src={`${msg.mediaUrl}#t=0.1`} controls preload="metadata" playsInline className="max-w-full max-h-80 bg-black" />
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
      </div>

      {/*
        Input bar — absolutely positioned so it sits on top of the
        messages scroller and follows the iOS keyboard. The messages
        scroller's padding-bottom mirrors these offsets so nothing is
        clipped underneath.
      */}
      <div
        ref={inputBarRef}
        className="absolute left-0 right-0 bg-white border-t border-gray-200 px-4 py-3"
        style={{ bottom: `max(${keyboardHeight}px, env(safe-area-inset-bottom))` }}
      >
        {/* Pending media preview */}
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
        {sendError && (
          <p className="text-xs text-red-500 mb-2">
            {sendError}{" "}
            <button
              onClick={() => setSendError("")}
              className="underline text-red-700"
              aria-label="Dismiss error"
            >
              Dismiss
            </button>
          </p>
        )}
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
              // key — see chat/group/[chatId]/page.tsx for why.
              <svg key="spinner" className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            ) : (
              <svg key="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
          />
          <EmojiPicker open={emojiOpen} onOpenChange={setEmojiOpen} onSelect={insertEmoji} />
          <button
            // Keep the OSK up on send — see chat/group/[chatId]/page.tsx
            // for the full rationale. Tapping a <button> on iOS WKWebView
            // would otherwise shift focus from the input to the button
            // and dismiss the keyboard.
            onMouseDown={(e) => e.preventDefault()}
            onTouchStart={(e) => e.preventDefault()}
            onClick={handleSend}
            disabled={(!input.trim() && !pendingMedia) || sending || uploading}
            className="w-10 h-10 rounded-full bg-court-green text-white flex items-center justify-center hover:bg-court-green-light transition-colors disabled:opacity-40 disabled:hover:bg-court-green shrink-0"
          >
            {sending ? (
              <svg key="spinner" className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            ) : (
              <svg key="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22,2 15,22 11,13 2,9" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <MessageReactionBar
        anchorRect={reactionPopover?.rect ?? null}
        currentReaction={popoverCurrent ?? null}
        onSelect={(key) => {
          if (reactionPopover) applyReaction(reactionPopover.msgId, key);
          setReactionPopover(null);
        }}
        onClose={() => setReactionPopover(null)}
        onDelete={
          popoverIsMine && reactionPopover
            ? () => {
                const id = reactionPopover.msgId;
                setReactionPopover(null);
                void deleteMessage(id);
              }
            : undefined
        }
      />
    </div>,
    document.body
  );
}

