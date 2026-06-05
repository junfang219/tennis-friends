"use client";

import { useCallback, useEffect, useLayoutEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import Avatar from "@/components/Avatar";
import EmojiPicker from "@/components/EmojiPicker";
import SplitCostSheet from "@/components/SplitCostSheet";
import SharedPostCard, { type SharedPost } from "@/components/SharedPostCard";
import ChatFindPlayerButton from "@/components/chat/ChatFindPlayerButton";
import MessageReactionBar from "@/components/MessageReactionBar";
import MessageReactions, { type MessageReaction as MsgReaction } from "@/components/MessageReactions";
import { useLongPress } from "@/hooks/useLongPress";
import { useKeyboardHeight } from "@/hooks/useKeyboardHeight";
import { useIsDesktopChat } from "@/hooks/useIsDesktopChat";
import type { ReactionKey } from "@/lib/reactions";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useRealtimeTable } from "@/lib/supabase/realtime";
import {
  getChatBundle,
  getChatGameContext,
  markChatRead,
  sendChatMessage,
  addReaction,
  removeReaction,
  listReactionsForMessages,
  loadSharedPosts,
} from "@/lib/supabase/queries";
import { toChatMessageCamel } from "@/lib/supabase/adapters";
import { errorMessage } from "@/lib/errorMessage";
import { resolveFacilityByName } from "@/lib/facilities";
import { renderChatMessage } from "@/lib/renderChatMessage";
import { gameWindowMs, isReportEligibleCategory } from "@/lib/courtPrompt";
import { GameCourtPrompt } from "@/components/courts/GameCourtPrompt";

// Page Message is the shared ChatMessageCamel adapter (which handles
// snake→camel + pgToIso on createdAt) plus the per-message reaction list
// the chat UI maintains in component state.
type Message = ReturnType<typeof toChatMessageCamel> & {
  reactions?: MsgReaction[];
  sharedPost?: SharedPost | null;
};

type ChatInfo = {
  id: string;
  name: string;
  creatorId: string;
  friendGroupId: string | null;
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
  const isDesktop = useIsDesktopChat();
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInfo, setChatInfo] = useState<ChatInfo | null>(null);
  // Court-availability prompt context — set only for confirmed find_players
  // games at a report-eligible venue. Drives the in-thread GameCourtPrompt.
  const [courtPrompt, setCourtPrompt] = useState<{
    postId: string;
    courtId: string;
    startMs: number;
    endMs: number;
  } | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [error, setError] = useState("");
  const [showRename, setShowRename] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [showMembers, setShowMembers] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<{ url: string; type: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [reactionPopover, setReactionPopover] = useState<{ msgId: string; rect: DOMRect } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const inputBarRef = useRef<HTMLDivElement>(null);
  // Deep-link target from a tapped reaction notification (/chat/group/<id>?msg=…),
  // snapshotted once so re-renders don't keep re-firing the focus effect.
  const searchParams = useSearchParams();
  const focusTargetRef = useRef<string | null>(searchParams.get("msg"));
  const focusHandledRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keyboard height in px (0 when closed). On native (Capacitor) the
  // hook subscribes to @capacitor/keyboard's keyboardWillShow/Hide; on
  // web it reads window.visualViewport. Native trusts the plugin only
  // (no VisualViewport merge) — see useKeyboardHeight for why.
  const keyboardHeight = useKeyboardHeight();

  // Lock body scroll while the chat thread is mounted so iOS bounce /
  // pull-to-refresh doesn't drag the page around behind the fixed chat
  // surface. Skip on desktop — the chat surface is contained in the right
  // pane there, and locking the body would also freeze the sidebar.
  useEffect(() => {
    if (isDesktop) return;
    const prevOverflow = document.body.style.overflow;
    const prevOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.overscrollBehavior = prevOverscroll;
    };
  }, [isDesktop]);

  // `mounted` gates the createPortal call so the server render produces
  // nothing for this branch (createPortal can't run during SSR — there's
  // no document). On the client the first effect tick flips it true and
  // the portal mounts on the same paint. The setState-in-effect lint
  // warning is the standard SSR-mount pattern for portals, not a real
  // perf concern (a single one-time flip).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // Live-measure the input bar so the messages scroller can reserve
  // exactly enough padding-bottom — the bar grows when a media preview
  // is attached, when an upload error wraps, etc. ResizeObserver covers
  // both the initial mount and any post-mount size change.
  const [inputBarHeight, setInputBarHeight] = useState(72);
  useLayoutEffect(() => {
    const el = inputBarRef.current;
    if (!el) return;
    // Measure synchronously on first commit so the messages scroller's
    // paddingBottom reflects the real bar height on initial paint. The
    // 72 default underestimates once the home-indicator safe-area inset
    // is added — without this the last bubble's timestamp gets cropped
    // behind the input bar until the async ResizeObserver tick lands.
    // Deps include `mounted` because the first render returns null (the
    // portal hasn't mounted yet) — the first effect pass would otherwise
    // find inputBarRef.current === null and bail, leaving the observer
    // unattached forever.
    const initial = el.offsetHeight;
    if (initial > 0) setInputBarHeight(initial);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const h = e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height;
        if (h > 0) setInputBarHeight(h);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [mounted]);



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

  // Initial paint: pull chat + participants + first page of messages in
  // a single nested PostgREST round trip. The previous version issued
  // three parallel queries (getChat / listChatParticipants /
  // listChatMessages) and the header (chat name + member avatars)
  // blocked on the slowest of the first two — noticeable on a phone
  // hitting the LAN dev server, where each request adds connection +
  // RLS-check overhead. After this initial fetch, new messages stream
  // in via the realtime subscription below — no polling.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    // Clear the unread badge as soon as the user opens the thread.
    // Fire-and-forget; failures are tolerable (next mount or realtime tick
    // will re-mark) and we don't want to block the initial paint on it.
    void markChatRead(supabase, chatId).catch(() => {});
    getChatBundle(supabase, chatId)
      .then(async (bundle) => {
        if (!bundle) {
          setError("Chat not found.");
          return;
        }
        const { chat: c, participants, messages: msgs } = bundle;
        setChatInfo({
          id: c.id,
          name: c.name,
          creatorId: c.creator_id,
          friendGroupId: c.friend_group_id,
          participants: participants.map((p) => ({
            id: p.user.id,
            name: p.user.name,
            profileImageUrl: p.user.profile_image_url,
          })),
          guestNames: (c.manual_player_names || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        });
        // Resolve any embedded Looking-for-Player cards in one batch.
        const sharedIds = msgs
          .map((m) => m.shared_post_id)
          .filter((id): id is string => !!id);
        const sharedMap = sharedIds.length
          ? await loadSharedPosts(supabase, sharedIds).catch(
              () => new Map<string, SharedPost>()
            )
          : new Map<string, SharedPost>();
        // Fetch reactions so they survive a reopen/reload — they live in a
        // sibling table (message_reactions), not on the chat_messages row.
        const reactionRows = msgs.length
          ? await listReactionsForMessages(
              supabase,
              "chat",
              msgs.map((m) => m.id)
            ).catch(() => [])
          : [];
        const reactionsByMsg = new Map<string, MsgReaction[]>();
        for (const r of reactionRows) {
          const arr = reactionsByMsg.get(r.target_id) ?? [];
          arr.push({ emoji: r.emoji, userId: r.user_id, userName: r.user.name });
          reactionsByMsg.set(r.target_id, arr);
        }
        setMessages(
          msgs.map((m) => ({
            ...toChatMessageCamel(m),
            reactions: reactionsByMsg.get(m.id) ?? [],
            sharedPost: m.shared_post_id ? sharedMap.get(m.shared_post_id) ?? null : null,
          }))
        );

        // Confirmed-game chats carry a post_id. If the game is at a
        // report-eligible court, surface the in-thread availability prompt.
        if (c.post_id) {
          const postId = c.post_id;
          getChatGameContext(supabase, postId)
            .then((game) => {
              if (!game) return;
              const facility = resolveFacilityByName(game.courtLocation);
              if (!facility || !isReportEligibleCategory(facility.category)) return;
              const win = gameWindowMs({
                playDate: game.playDate,
                playTime: game.playTime,
                playDuration: game.playDuration,
              });
              if (!win) return;
              setCourtPrompt({
                postId,
                courtId: facility.courtId,
                startMs: win.startMs,
                endMs: win.endMs,
              });
            })
            .catch(() => {
              /* prompt is best-effort; ignore */
            });
        }
      })
      .catch(() => setError("You are not a participant of this chat."));
  }, [chatId]);

  // Live-append incoming messages via Postgres CDC instead of polling.
  // The previous 3-second poll re-fetched all 100 messages and replaced
  // the React state array, which re-rendered every bubble (avatar +
  // long-press handler + reactions + media) every poll — heavy enough
  // on iOS WKWebView to feel "stuck" and drop taps on Send. Realtime
  // only fires for actually-new rows and appends one at a time.
  //
  // Sender details aren't part of the realtime payload (PostgREST joins
  // don't apply to CDC), but RLS guarantees the sender is a chat
  // participant — so chatInfo.participants always has them. If that
  // lookup misses (e.g., a brand-new participant joined after we loaded
  // chatInfo), the bubble renders with a "…" placeholder name until the
  // user reopens the thread. The next round of work can re-fetch
  // participants on chat_participants INSERTs if that becomes noisy.
  useRealtimeTable(
    {
      table: "chat_messages",
      // Subscribe to all events: INSERT (new messages), UPDATE (expense
      // announcement rewritten when the payer edits an expense), DELETE
      // (cascade from an expense delete).
      event: "*",
      filter: `chat_id=eq.${chatId}`,
      onChange: (payload) => {
        if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
          const row = payload.new as {
            id: string;
            chat_id: string;
            sender_id: string;
            content: string | null;
            media_url: string | null;
            media_type: string | null;
            shared_post_id: string | null;
            created_at: string;
          };
          // If a message arrives from someone else while the thread is open,
          // bump last_read_at so the badge clears immediately instead of
          // waiting for the next tab focus / re-open.
          if (payload.eventType === "INSERT" && row.sender_id !== myId) {
            const supabase = createSupabaseBrowserClient();
            void markChatRead(supabase, chatId).catch(() => {});
          }
          setMessages((prev) => {
            const existingIdx = prev.findIndex((m) => m.id === row.id);
            if (existingIdx >= 0) {
              // UPDATE — replace content in place. Also covers the
              // dedupe case where INSERT arrives after the optimistic
              // add in handleSend.
              const next = [...prev];
              next[existingIdx] = {
                ...next[existingIdx],
                content: row.content || "",
                mediaUrl: row.media_url || "",
                mediaType: row.media_type || "",
              };
              return next;
            }
            const sender = chatInfo?.participants.find((p) => p.id === row.sender_id);
            const msg: Message = {
              id: row.id,
              chatId: row.chat_id,
              senderId: row.sender_id,
              content: row.content || "",
              mediaUrl: row.media_url || "",
              mediaType: row.media_type || "",
              sharedPostId: row.shared_post_id ?? null,
              createdAt: new Date(row.created_at).toISOString(),
              sender: sender
                ? {
                    id: sender.id,
                    name: sender.name,
                    profileImageUrl: sender.profileImageUrl,
                  }
                : { id: row.sender_id, name: "…", profileImageUrl: "" },
              reactions: [],
              sharedPost: null,
            };
            return [...prev, msg];
          });
          // A Looking-for-Player card arrives over realtime as a message with
          // shared_post_id but no resolved body — fetch it and patch the bubble.
          if (payload.eventType === "INSERT" && row.shared_post_id) {
            const sharedId = row.shared_post_id;
            const supabase = createSupabaseBrowserClient();
            loadSharedPosts(supabase, [sharedId])
              .then((map) => {
                const sp = map.get(sharedId);
                if (!sp) return;
                setMessages((prev) =>
                  prev.map((m) => (m.id === row.id ? { ...m, sharedPost: sp } : m))
                );
              })
              .catch(() => {});
          }
        } else if (payload.eventType === "DELETE") {
          // DELETE payload only carries the primary key by default
          // (REPLICA IDENTITY DEFAULT). Removing by id is sufficient.
          const oldRow = payload.old as { id?: string };
          if (!oldRow.id) return;
          setMessages((prev) => prev.filter((m) => m.id !== oldRow.id));
        }
      },
    },
    [chatId, chatInfo]
  );

  // Sticky-to-bottom scroll model (iPhone Messages convention) — identical
  // to the DM thread (src/app/chat/[userId]/page.tsx).
  //
  // The previous version had three rAF-based effects (keyboard, messages,
  // ResizeObserver) that all stashed their pending frame on the same `_raf2`
  // slot on the scroll element, so their cleanups cancelled each other's
  // scrolls. On the keyboard-open path this left the latest message sitting
  // in the freshly-revealed area *under* the input bar — the bug reported
  // for the session/game chat: "the keyboard didn't adapt, new text can't be
  // seen." (The DM chat already moved to this model in da53dad; this brings
  // the session chat in line so all threads behave the same.)
  //
  // Model: a ref tracks whether the user is anchored to the bottom. The
  // onScroll handler flips it false when they drag up past 100px and true
  // when they come back near. A single useLayoutEffect re-pins to
  // scrollHeight whenever content grows (messages.length / keyboardHeight /
  // inputBarHeight) but ONLY while still anchored. useLayoutEffect runs
  // after React commits the new DOM but before paint, so scrollHeight already
  // reflects the new content — no rAF dance, no clobbering.
  // Start anchored to the bottom UNLESS a ?msg= deep-link is active — then the
  // deep-link effect below scrolls to that bubble instead.
  const stickToBottomRef = useRef(!focusTargetRef.current);

  // Re-anchor on chat switch so a fresh thread always opens at the bottom
  // (but never override a pending deep-link).
  useEffect(() => {
    stickToBottomRef.current = !focusTargetRef.current;
  }, [chatId]);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < 100;
  }, []);

  useLayoutEffect(() => {
    if (focusTargetRef.current && !focusHandledRef.current) return;
    if (!stickToBottomRef.current) return;
    const el = messagesScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, keyboardHeight, inputBarHeight, chatId]);

  // Deep-link: scroll to and briefly highlight the reacted message (?msg=…).
  useEffect(() => {
    const targetId = focusTargetRef.current;
    if (!targetId || focusHandledRef.current) return;
    if (!messages.some((m) => m.id === targetId)) return;
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
    try {
      const supabase = createSupabaseBrowserClient();
      const row = await sendChatMessage(supabase, chatId, input, {
        mediaUrl: pendingMedia?.url,
        mediaType: pendingMedia?.type,
      });
      const msg: Message = { ...toChatMessageCamel(row), reactions: [] };
      setMessages((prev) => [...prev, msg]);
      setInput("");
      setPendingMedia(null);
      // Do NOT call inputRef.current?.focus() — the input is already
      // focused (Send was tapped or Enter was pressed). Calling focus()
      // on an already-focused input in iOS WKWebView triggers a brief
      // resign/become-first-responder cycle, which dismisses and
      // re-presents the keyboard ("bounce"). iMessage/WhatsApp keep
      // the keyboard up by leaving focus alone.
    } catch (err) {
      setSendError(errorMessage(err, "Couldn't send."));
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
      // Clear locally; future messages stream in via the realtime
      // subscription. Older messages stay hidden until the page is
      // reopened (matches the "clear is per-user view-only" semantics).
      setMessages([]);
    }
  };

  const applyReaction = async (msgId: string, key: ReactionKey | null) => {
    if (!myId) return;
    // Snapshot the user's existing reaction so a swap/toggle-off deletes the
    // stale row — otherwise the (target,user,emoji)-unique table keeps the old
    // emoji and the next reaction fetch shows two reactions. Mirrors the DM
    // handler in chat/[userId]/page.tsx.
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
        await removeReaction(supabase, "chat", msgId, prevEmoji);
      }
      if (key !== null && prevEmoji !== key) {
        await addReaction(supabase, "chat", msgId, key);
      }
    } catch {
      // Next reaction fetch will reconcile.
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

  if (!mounted) return null;

  // Fixed full-viewport chat surface, rendered via createPortal directly
  // into <body>. The portal is the load-bearing piece: it bypasses every
  // possible ancestor-induced containing block (a transform / filter /
  // contain on any wrapper would otherwise re-anchor `position: fixed`
  // to that ancestor instead of the viewport — the symptom is the input
  // bar floating mid-screen with messages visible above AND below it).
  // Rendering under <body> makes the chat surface immune to current and
  // future ancestor layout changes.
  //
  // We deliberately avoid 100dvh / 100svh inside — both lie on iOS
  // Safari while the keyboard is open. The whole surface is anchored
  // to the viewport corners (`fixed inset-0`) and the messages scroller
  // + input bar follow the keyboardHeight from useKeyboardHeight
  // (Capacitor events on native, VisualViewport on web).
  const surface = (
    <div className={isDesktop ? "absolute inset-0 flex flex-col bg-surface" : "fixed inset-0 z-50 flex flex-col bg-surface"}>
      {/* Header. paddingTop pulls in the iOS top safe area
          (notch / dynamic island). */}
      <div
        className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0"
        style={{ paddingTop: isDesktop ? undefined : "calc(0.75rem + env(safe-area-inset-top))" }}
      >
        {!isDesktop && (
          <button
            onClick={() => router.push("/friends")}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="15,18 9,12 15,6" />
            </svg>
          </button>
        )}
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
                  onClick={() => setShowMembers(true)}
                  className="text-left w-full"
                  title="View members"
                >
                  <p className="text-sm font-semibold text-gray-900 truncate">{title}</p>
                  <p className="text-xs text-gray-400">{chatInfo.participants.length} members</p>
                </button>
              )}
            </div>
            {/* Overflow menu hides while the rename input is up so the
                input + Save/Cancel don't collide with it. */}
            {!showRename && (
              <button
                onClick={() => setShowMenu(true)}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500 shrink-0"
                title="More actions"
                aria-label="More actions"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="5" r="1.75" />
                  <circle cx="12" cy="12" r="1.75" />
                  <circle cx="12" cy="19" r="1.75" />
                </svg>
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-1">
            <div className="skeleton w-10 h-10 rounded-xl" />
            <div className="skeleton w-32 h-4" />
          </div>
        )}
      </div>

      {/*
        Messages — the only scrolling region. min-h-0 lets flex shrink
        it below its content height so the parent's height (not its
        own) wins. paddingBottom reserves space for the absolutely-
        positioned input bar + the OSK + the home indicator, so a
        scroll-to-bottom lands the last bubble flush above the input
        rather than behind it.
      */}
      <div
        ref={messagesScrollRef}
        onScroll={handleMessagesScroll}
        className="flex-1 overflow-y-auto min-h-0 px-4 py-4 bg-surface/50 net-texture"
        style={{
          // inputBarHeight already includes the input bar's own safe-area
          // padding (see the paddingBottom on the input bar below), so we
          // only add keyboard + a small breathing gap here.
          paddingBottom: `calc(${inputBarHeight}px + ${keyboardHeight}px + 0.5rem)`,
        }}
      >
        {/* min-h-full + justify-end gives iMessage-style bottom
            alignment: when there are only a couple of bubbles, they
            sit just above the input bar instead of stacking under the
            header. Long threads overflow normally because the inner
            div grows past min-h-full. */}
        <div className="min-h-full flex flex-col justify-end">
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
                    id={`msg-${msg.id}`}
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
                    {msg.sharedPost && (
                      <div className={isMe ? "ml-auto" : ""}>
                        <SharedPostCard post={msg.sharedPost} />
                      </div>
                    )}
                    {msg.sharedPostId && !msg.sharedPost && (
                      <div className={`bg-white rounded-xl border border-gray-200 shadow-sm px-3 py-2.5 max-w-full ${isMe ? "ml-auto" : ""}`}>
                        <p className="text-[11px] font-medium text-gray-400">Shared post</p>
                      </div>
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
                        <p className="whitespace-pre-wrap break-words">{renderChatMessage(msg.content)}</p>
                        <p className={`text-[10px] mt-1 ${isMe ? "text-white/60" : "text-gray-400"}`}>
                          {formatTime(msg.createdAt)}
                        </p>
                      </div>
                    )}
                    {(msg.mediaUrl || msg.sharedPostId) && !msg.content && (
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
        {courtPrompt && (
          <GameCourtPrompt
            chatId={chatId}
            postId={courtPrompt.postId}
            courtId={courtPrompt.courtId}
            startMs={courtPrompt.startMs}
            endMs={courtPrompt.endMs}
          />
        )}
        <div ref={messagesEndRef} />
        </div>
      </div>

      {/*
        Input bar — absolutely positioned so it sits ON TOP of the
        messages scroller and follows the OSK. bottom = max(keyboard,
        safe-area-bottom): when the keyboard is up the home indicator
        is hidden under it, so adding the inset would just open a
        cosmetic gap between the input bar and the keyboard (verified
        by device logs — 34px gap, May 2026). When the keyboard is
        closed, max() falls back to the safe-area inset so the bar
        sits above the home indicator. The messages scroller's
        padding-bottom mirrors the same math so nothing is clipped.
      */}
      <div
        ref={inputBarRef}
        className="absolute left-0 right-0 bg-white border-t border-gray-200 px-4 py-3"
        // Sit flush against the bottom of the surface (or the keyboard when
        // it's up). The bar's bottom padding absorbs the home-indicator
        // inset so its white background extends edge-to-edge — matches the
        // iMessage / WhatsApp convention.
        style={{
          bottom: `${keyboardHeight}px`,
          // The home-indicator inset is only needed when the keyboard is
          // down. When it's up the bar sits directly on the keyboard, so
          // the inset would just be dead space — drop it to close the gap.
          paddingBottom:
            keyboardHeight > 0
              ? "0.75rem"
              : "calc(0.75rem + env(safe-area-inset-bottom))",
        }}
      >
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
            >
              Dismiss
            </button>
          </p>
        )}
        <div className="flex items-center gap-2">
          {chatInfo && (
            <ChatFindPlayerButton
              chatTarget={
                chatInfo.friendGroupId
                  ? {
                      kind: "club",
                      chatId,
                      friendGroupId: chatInfo.friendGroupId,
                      name: chatInfo.name || "this club",
                    }
                  : { kind: "session", chatId, name: chatInfo.name || "this chat" }
              }
            />
          )}
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
              // key forces React to treat the spinner and the icon as
              // distinct elements instead of reconciling props on the
              // same <svg> — otherwise React tries to remove width /
              // height by setting them to "" and the console fills with
              // `Invalid value for <svg> attribute width=""` errors.
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
            placeholder={`Message ${title || "group"}...`}
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-full text-sm bg-surface/50 focus:bg-white transition-colors"
          />
          <EmojiPicker open={emojiOpen} onOpenChange={setEmojiOpen} onSelect={insertEmoji} />
          <button
            // Preemptive fix (BUG B): on iOS WKWebView, tapping a
            // <button> shifts focus from the active input to the
            // button — which dismisses the OSK. preventDefault on the
            // pointerdown phase keeps the input as the first
            // responder so the keyboard stays up. This is the standard
            // chat-UI pattern (used by WhatsApp web, Slack, etc.).
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
      {showMenu && chatInfo && (
        <div
          className="fixed inset-0 z-[999] bg-black/30 flex justify-end items-start pr-3"
          style={{ paddingTop: "calc(3.75rem + env(safe-area-inset-top))" }}
          onClick={() => setShowMenu(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-56 overflow-hidden animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setShowMenu(false);
                setShowSplit(true);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left text-sm text-gray-700"
            >
              <span className="text-base">💵</span>
              <span>Split a cost</span>
            </button>
            <button
              onClick={() => {
                setShowMenu(false);
                setRenameValue(chatInfo.name);
                setShowRename(true);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left text-sm text-gray-700"
            >
              <span className="text-base">✏️</span>
              <span>Rename chat</span>
            </button>
            <button
              onClick={() => {
                setShowMenu(false);
                clearHistory();
              }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left text-sm text-gray-700"
            >
              <span className="text-base">🧹</span>
              <span>Clear chat history</span>
            </button>
            <div className="border-t border-gray-100" />
            <button
              onClick={() => {
                setShowMenu(false);
                leaveChat();
              }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-red-50 text-left text-sm text-red-600"
            >
              <span className="text-base">🚪</span>
              <span>Leave chat</span>
            </button>
          </div>
        </div>
      )}
      {showSplit && chatInfo && (
        <SplitCostSheet
          chatId={chatId}
          participants={chatInfo.participants}
          guestNames={chatInfo.guestNames}
          myId={myId}
          keyboardHeight={keyboardHeight}
          onClose={() => setShowSplit(false)}
          // The expense flow inserts a chat_messages row server-side;
          // the realtime subscription above will pick it up — no need
          // for a manual refresh here.
          onExpenseCreated={() => {}}
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

  return isDesktop ? surface : createPortal(surface, document.body);
}
