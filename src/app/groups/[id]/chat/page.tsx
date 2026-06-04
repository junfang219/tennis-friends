"use client";

import { useCallback, useEffect, useLayoutEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import EmojiPicker from "@/components/EmojiPicker";
import SharedPostCard, { type SharedPost } from "@/components/SharedPostCard";
import MessageReactionBar from "@/components/MessageReactionBar";
import MessageReactions, { type MessageReaction as MsgReaction } from "@/components/MessageReactions";
import { useLongPress } from "@/hooks/useLongPress";
import type { ReactionKey } from "@/lib/reactions";
import { canCaptain, type TeamRole } from "@/lib/groupRoles";
import PollCard, { type PollData } from "@/components/PollCard";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  getGroup,
  listGroupMembers,
  listGroupMessages,
  sendGroupMessage,
  markTeamRead,
  addReaction,
  removeReaction,
  listReactionsForMessages,
  createPollInGroup,
  votePoll,
  setPollClosed,
  getPollsByIds,
  loadSharedPosts,
} from "@/lib/supabase/queries";
import ChatFindPlayerButton from "@/components/chat/ChatFindPlayerButton";
import { uploadToBucket, isUploadError } from "@/lib/supabase/upload";
import { toGroupMessageCamel } from "@/lib/supabase/adapters";
import { errorMessage } from "@/lib/errorMessage";
import { useKeyboardHeight } from "@/hooks/useKeyboardHeight";
import { useIsDesktopChat } from "@/hooks/useIsDesktopChat";

// Page Message is the shared GroupMessageCamel adapter (snake→camel +
// pgToIso on createdAt and pinnedAt) plus the resolved shared-post body,
// resolved poll body, and reactions list the chat UI maintains alongside.
// kind in the adapter is "chat" | "announcement" — announcements render
// highlighted with a captain-authored badge.
type Message = ReturnType<typeof toGroupMessageCamel> & {
  sharedPost?: SharedPost | null;
  poll?: PollData | null;
  reactions?: MsgReaction[];
};

type Member = { userId: string; roles: TeamRole[] };

type GroupInfo = {
  id: string;
  name: string;
  imageUrl?: string | null;
  ownerId: string;
  members: Member[];
  _count: { members: number };
  // Set when this group is backing an Event — back nav should return there.
  event?: { id: string } | null;
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
  const isDesktop = useIsDesktopChat();
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [groupInfo, setGroupInfo] = useState<GroupInfo | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<{ url: string; type: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [reactionPopover, setReactionPopover] = useState<{ msgId: string; rect: DOMRect } | null>(null);
  // Announcement composer state — CAPTAIN+ can toggle this on per message.
  const [announcementMode, setAnnouncementMode] = useState(false);
  const [announcementEmail, setAnnouncementEmail] = useState(true);
  const [sendError, setSendError] = useState("");
  // Poll composer state. Any member can create a poll; the composer is a
  // small inline form so it doesn't displace the regular chat input.
  const [pollMode, setPollMode] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [pollIsMulti, setPollIsMulti] = useState(false);
  const [pollSending, setPollSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputBarRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Same keyboard-aware layout as the DM chat (src/app/chat/[userId]/page.tsx).
  // Without this the iOS keyboard slides up over the input bar and there's
  // nothing the user can type into. The hook reports the keyboard height
  // (Capacitor Keyboard plugin on native, VisualViewport on web); the input
  // bar gets absolutely positioned at that offset, and the messages scroller
  // reserves equal padding-bottom so nothing is clipped underneath.
  const keyboardHeight = useKeyboardHeight();
  const [inputBarHeight, setInputBarHeight] = useState(72);
  useLayoutEffect(() => {
    const el = inputBarRef.current;
    if (!el) return;
    // Measure synchronously on first commit so the messages scroller's
    // paddingBottom reflects the real bar height on initial paint. The
    // 72 default underestimates once the home-indicator safe-area inset
    // is added — without this the last bubble's timestamp gets cropped
    // behind the input bar until the async ResizeObserver tick lands.
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
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");
    setUploading(true);
    const upResult = await uploadToBucket(file, "posts");
    if (isUploadError(upResult)) {
      setUploadError(upResult.message);
    } else {
      setPendingMedia({ url: upResult.url, type: upResult.mediaType });
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const groupId = params.id as string;

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

  // Load group info
  useEffect(() => {
    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const [g, members] = await Promise.all([
          getGroup(supabase, groupId),
          listGroupMembers(supabase, groupId),
        ]);
        if (!g) {
          setError("Group not found.");
          return;
        }
        const adaptedMembers = members.map((m) => ({
          id: m.id,
          userId: m.user_id,
          roles: m.roles,
          user: {
            id: m.user.id,
            name: m.user.name,
            profileImageUrl: m.user.profile_image_url,
          },
        }));
        setGroupInfo({
          id: g.id,
          name: g.name,
          imageUrl: g.image_url,
          ownerId: g.owner_id,
          members: adaptedMembers,
          // Header reads _count.members to render the "N members" pill —
          // without this, the chat page crashes with
          // "undefined is not an object (groupInfo._count.members)" the
          // first time it renders for any team. Kept as an object (not
          // members.length inlined) so the legacy GroupInfo type stays
          // intact across both this page and group landing.
          _count: { members: adaptedMembers.length },
        } as unknown as typeof groupInfo);
      } catch {
        setError("You are not a member of this group.");
      }
    })();
  }, [groupId]);

  // Load messages
  const loadMessages = () => {
    const supabase = createSupabaseBrowserClient();
    listGroupMessages(supabase, groupId)
      .then(async (rows) => {
        // Resolve every poll referenced by the visible messages in a single
        // batch (one query for polls + one for options + one for votes).
        // Without this, poll messages render as plain text because the
        // chat row only carries the `poll_id` FK, not the body.
        const pollIds = Array.from(
          new Set(rows.map((m) => m.poll_id).filter((id): id is string => !!id))
        );
        const pollMap = pollIds.length > 0
          ? await getPollsByIds(supabase, pollIds)
          : new Map();
        // Resolve embedded Looking-for-Player cards (shared_post_id) the same
        // way — the chat row only carries the FK, not the post body.
        const sharedIds = Array.from(
          new Set(rows.map((m) => m.shared_post_id).filter((id): id is string => !!id))
        );
        const sharedMap = sharedIds.length > 0
          ? await loadSharedPosts(supabase, sharedIds).catch(() => new Map<string, SharedPost>())
          : new Map<string, SharedPost>();
        // Fetch reactions every poll — they live in message_reactions, not on
        // the group_messages row. Without this the 3s poll rebuilds with no
        // reactions and any just-added emoji vanishes.
        const reactionRows = rows.length
          ? await listReactionsForMessages(supabase, "group", rows.map((m) => m.id)).catch(() => [])
          : [];
        const reactionsByMsg = new Map<string, MsgReaction[]>();
        for (const r of reactionRows) {
          const arr = reactionsByMsg.get(r.target_id) ?? [];
          arr.push({ emoji: r.emoji, userId: r.user_id, userName: r.user.name });
          reactionsByMsg.set(r.target_id, arr);
        }
        setMessages(
          rows.map((m) => ({
            ...toGroupMessageCamel(m),
            reactions: reactionsByMsg.get(m.id) ?? [],
            poll: m.poll_id ? pollMap.get(m.poll_id) ?? null : null,
            sharedPost: m.shared_post_id ? sharedMap.get(m.shared_post_id) ?? null : null,
          }))
        );
      })
      .catch(() => {});
  };

  // Mark the team chat read whenever we open it or poll for new messages.
  // Without this, the Messages inbox unread badge for this team never
  // clears — listMyTeamThreads counts messages newer than
  // group_members.last_read_at, so we have to advance that timestamp here
  // (mirrors the markDmRead pattern in /chat/[userId]).
  const markRead = () => {
    const supabase = createSupabaseBrowserClient();
    void markTeamRead(supabase, groupId).catch(() => {});
  };

  useEffect(() => {
    loadMessages();
    markRead();
    pollRef.current = setInterval(() => {
      loadMessages();
      markRead();
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // Sticky-to-bottom scroll model (iPhone Messages convention) — matches the
  // DM (chat/[userId]) and session (chat/group/[chatId]) threads so all chats
  // behave identically. Re-pins to scrollHeight whenever content grows
  // (messages.length / keyboardHeight / inputBarHeight — keyboard opening,
  // poll composer expanding, announcement chip wrapping) but ONLY while the
  // user is anchored to the bottom. Uses scrollTop on the scroll container
  // (not scrollIntoView on a sentinel — iOS WKWebView has been observed
  // scrolling the document instead of the container) inside a useLayoutEffect,
  // which runs after commit but before paint, so scrollHeight already reflects
  // the new content with no rAF dance.
  const stickToBottomRef = useRef(true);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < 100;
  }, []);

  useLayoutEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = messagesScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, keyboardHeight, inputBarHeight]);

  const handleSend = async () => {
    if ((!input.trim() && !pendingMedia) || sending || uploading) return;
    setSending(true);
    setSendError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const row = await sendGroupMessage(supabase, groupId, input, {
        mediaUrl: pendingMedia?.url,
        mediaType: pendingMedia?.type,
        kind: announcementMode ? "announcement" : "chat",
      });
      const msg: Message = { ...toGroupMessageCamel(row), reactions: [] };
      setMessages((prev) => [...prev, msg]);
      setInput("");
      setPendingMedia(null);
      setAnnouncementMode(false);
      // Intentionally NOT calling inputRef.current?.focus() — see
      // chat/group/[chatId]/page.tsx for full rationale. The input is already
      // focused (Send was tapped or Enter was pressed); calling focus() on an
      // already-focused input on iOS WKWebView triggers a resign/become-
      // first-responder cycle that dismisses and re-presents the keyboard
      // (the "bounce"). iMessage/WhatsApp keep the keyboard up by leaving
      // focus alone.
    } catch (err) {
      setSendError(errorMessage(err, "Failed to send."));
    }
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const myId = session?.user?.id || "";
  const myRoles = groupInfo?.members.find((m) => m.userId === myId)?.roles ?? [];
  const isOwner = !!myId && groupInfo?.ownerId === myId;
  const canPostAnnouncement = canCaptain({ isOwner, roles: myRoles });
  const canManagePoll = canCaptain({ isOwner, roles: myRoles });

  const sendPoll = async () => {
    const cleanOptions = pollOptions.map((o) => o.trim()).filter((o) => o.length > 0);
    if (!pollQuestion.trim() || cleanOptions.length < 2 || pollSending) return;
    setPollSending(true);
    setSendError("");
    try {
      const supabase = createSupabaseBrowserClient();
      await createPollInGroup(supabase, groupId, {
        question: pollQuestion.trim(),
        options: cleanOptions,
        isMulti: pollIsMulti,
      });
      loadMessages();
      setPollMode(false);
      setPollQuestion("");
      setPollOptions(["", ""]);
      setPollIsMulti(false);
    } catch (err) {
      setSendError(errorMessage(err, "Failed to create poll."));
    }
    setPollSending(false);
  };

  const sendPollVote = async (pollId: string, optionIds: string[]) => {
    // Optimistically reconcile vote counts client-side so the bar moves
    // immediately. The next poll cycle reloads canonical totals.
    setMessages((prev) =>
      prev.map((m) => {
        if (m.poll?.id !== pollId) return m;
        const prevMine = new Set(m.poll.myOptionIds);
        const nextMine = new Set(optionIds);
        const nextOptions = m.poll.options.map((o) => {
          const wasMine = prevMine.has(o.id);
          const isMine = nextMine.has(o.id);
          let delta = 0;
          if (!wasMine && isMine) delta = 1;
          else if (wasMine && !isMine) delta = -1;
          return { ...o, voteCount: Math.max(0, o.voteCount + delta) };
        });
        const totalVotes = nextOptions.reduce((sum, o) => sum + o.voteCount, 0);
        return { ...m, poll: { ...m.poll, options: nextOptions, myOptionIds: optionIds, totalVotes } };
      })
    );
    try {
      const supabase = createSupabaseBrowserClient();
      await votePoll(supabase, pollId, optionIds);
    } catch {
      // Polling will reconcile.
    }
  };

  const togglePollClose = async (pollId: string, isClosed: boolean) => {
    setMessages((prev) =>
      prev.map((m) => m.poll?.id === pollId ? { ...m, poll: { ...m.poll, isClosed } } : m)
    );
    try {
      const supabase = createSupabaseBrowserClient();
      await setPollClosed(supabase, pollId, isClosed);
    } catch {
      // ignore
    }
  };

  const applyReaction = async (msgId: string, key: ReactionKey | null) => {
    if (!myId) return;
    // Snapshot the existing reaction so a swap/toggle-off deletes the stale
    // row — without this the unique (target,user,emoji) table keeps the old
    // emoji and the next poll shows two reactions. Mirrors the DM handler.
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
        await removeReaction(supabase, "group", msgId, prevEmoji);
      }
      if (key !== null && prevEmoji !== key) {
        await addReaction(supabase, "group", msgId, key);
      }
    } catch {
      // The 3s poll will reconcile.
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
    <div
      className={isDesktop ? "absolute inset-0 flex flex-col bg-surface" : "max-w-2xl mx-auto flex flex-col relative"}
      // Don't subtract safe-area-inset-bottom here — the input bar absorbs
      // the home-indicator inset via its own padding-bottom so its
      // background extends edge-to-edge (iMessage/WhatsApp convention).
      // On desktop the parent right pane already sizes us; absolute inset-0
      // fills it without re-computing viewport math.
      style={isDesktop ? undefined : { height: "calc(100dvh - 4rem - env(safe-area-inset-top))" }}
    >
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0">
        {!isDesktop && (() => {
          const parentHref = groupInfo?.event?.id
            ? `/events/${groupInfo.event.id}`
            : `/groups/${groupId}`;
          return (
            <Link
              href={parentHref}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="15,18 9,12 15,6" />
              </svg>
            </Link>
          );
        })()}
        {groupInfo ? (
          <Link
            href={groupInfo.event?.id ? `/events/${groupInfo.event.id}` : `/groups/${groupId}`}
            className="flex items-center gap-3 flex-1 min-w-0"
          >
            {groupInfo.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={groupInfo.imageUrl}
                alt={groupInfo.name}
                className="w-10 h-10 rounded-xl object-cover shadow-md shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-court-green to-court-green-soft flex items-center justify-center text-white font-bold text-sm shadow-md shrink-0">
                {groupInfo.name.charAt(0).toUpperCase()}
              </div>
            )}
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

      {/* Messages — paddingBottom reserves room for the absolutely-positioned
          input bar plus the iOS keyboard plus the home indicator inset. */}
      <div
        ref={messagesScrollRef}
        onScroll={handleMessagesScroll}
        className="flex-1 overflow-y-auto min-h-0 px-4 py-4 bg-surface/50 net-texture"
        style={{
          // inputBarHeight already includes the home-indicator inset (the
          // input bar adds it as paddingBottom), so we only add keyboard +
          // a small breathing gap here.
          paddingBottom: `calc(${inputBarHeight}px + ${keyboardHeight}px + 0.5rem)`,
        }}
      >
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
              const isAnnouncement = msg.kind === "announcement";
              const isPoll = !!msg.poll;
              const prevMsg = i > 0 ? group.messages[i - 1] : null;
              // Treat the boundary between an announcement and a regular
              // message as "different sender" — announcements always get
              // their own header row.
              const sameSender = !isAnnouncement
                && !isPoll
                && prevMsg?.senderId === msg.senderId
                && prevMsg.kind !== "announcement"
                && !prevMsg?.poll;
              const showAvatar = !isMe && !sameSender;
              const showName = !isMe && !sameSender;

              if (isPoll && msg.poll) {
                return (
                  <div key={msg.id} className={`flex items-end gap-2 ${isMe ? "justify-end" : "justify-start"} mt-3`}>
                    {!isMe && (
                      <div className="w-7 shrink-0">
                        <Avatar name={msg.sender.name} image={msg.sender.profileImageUrl} size="sm" />
                      </div>
                    )}
                    <div className="max-w-[85%]">
                      {!isMe && (
                        <p className="text-[11px] font-medium text-court-green-soft ml-1 mb-1">
                          {msg.sender.name}
                        </p>
                      )}
                      <PollCard
                        poll={msg.poll}
                        myUserId={myId}
                        canClose={canManagePoll || msg.senderId === myId}
                        onVoteChange={sendPollVote}
                        onToggleClose={togglePollClose}
                      />
                      <p className={`text-[10px] mt-1 ${isMe ? "text-right" : ""} text-gray-400`}>
                        {formatTime(msg.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              }

              if (isAnnouncement) {
                return (
                  <div key={msg.id} className="my-3 first:mt-0">
                    <div className="bg-gradient-to-br from-court-green-pale/30 to-ball-yellow/15 border border-court-green-pale/60 rounded-2xl p-4 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wider text-court-green bg-white/70 px-2 py-0.5 rounded-full uppercase">
                          📣 Announcement
                        </span>
                        {msg.notifyEmail && (
                          <span className="text-[10px] font-medium text-gray-500" title="Emailed to the team">
                            ✉️ emailed
                          </span>
                        )}
                        <span className="text-[10px] text-gray-400 ml-auto">{formatTime(msg.createdAt)}</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <Avatar name={msg.sender.name} image={msg.sender.profileImageUrl} size="sm" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-court-green-soft mb-1">{msg.sender.name}</p>
                          <p className="text-sm text-gray-900 whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

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
                    className="max-w-[75%] select-none sm:select-text"
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
                      <SharedPostCard post={msg.sharedPost} />
                    )}
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
                    {msg.mediaUrl && !msg.content && !msg.sharedPost && (
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

      {/* Input — absolutely positioned so it sits on top of the messages
          scroller and follows the iOS keyboard. The messages scroller's
          padding-bottom mirrors these offsets so nothing is clipped. */}
      <div
        ref={inputBarRef}
        className="absolute left-0 right-0 bg-white border-t border-gray-200 px-4 py-3"
        // Sit flush against the bottom (or the keyboard). The bar's bottom
        // padding absorbs the home-indicator inset so its white background
        // extends edge-to-edge — matches the iMessage / WhatsApp convention.
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
        {(canPostAnnouncement || groupInfo) && (
          <div className="mb-2 flex items-center gap-2 text-xs flex-wrap">
            {canPostAnnouncement && (
              <button
                type="button"
                onClick={() => { setAnnouncementMode((v) => !v); if (pollMode) setPollMode(false); }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold transition-colors ${
                  announcementMode
                    ? "bg-court-green text-white"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
                title="Post this as a team announcement"
              >
                📣 Announcement
              </button>
            )}
            {groupInfo && (
              <button
                type="button"
                onClick={() => { setPollMode((v) => !v); if (announcementMode) setAnnouncementMode(false); }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold transition-colors ${
                  pollMode
                    ? "bg-court-green text-white"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
                title="Start a poll"
              >
                📊 Poll
              </button>
            )}
            {announcementMode && (
              <label className="inline-flex items-center gap-1.5 text-gray-600">
                <input
                  type="checkbox"
                  checked={announcementEmail}
                  onChange={(e) => setAnnouncementEmail(e.target.checked)}
                  className="w-3.5 h-3.5 accent-court-green"
                />
                Also email the team
              </label>
            )}
          </div>
        )}
        {pollMode && (
          <div className="mb-3 p-3 rounded-xl border border-court-green-pale bg-court-green-pale/15 space-y-2">
            <input
              type="text"
              value={pollQuestion}
              onChange={(e) => setPollQuestion(e.target.value)}
              placeholder="Poll question (e.g. What time works best?)"
              maxLength={200}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-court-green"
            />
            {pollOptions.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={opt}
                  onChange={(e) => setPollOptions((cur) => cur.map((o, j) => (j === i ? e.target.value : o)))}
                  placeholder={`Option ${i + 1}`}
                  maxLength={80}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-court-green"
                />
                {pollOptions.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setPollOptions((cur) => cur.filter((_, j) => j !== i))}
                    className="w-7 h-7 rounded-full text-gray-400 hover:bg-gray-100 flex items-center justify-center"
                    aria-label="Remove option"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => pollOptions.length < 8 && setPollOptions((cur) => [...cur, ""])}
                disabled={pollOptions.length >= 8}
                className="text-court-green-soft hover:text-court-green font-semibold disabled:opacity-40"
              >
                + Add option
              </button>
              <label className="inline-flex items-center gap-1.5 text-gray-600">
                <input
                  type="checkbox"
                  checked={pollIsMulti}
                  onChange={(e) => setPollIsMulti(e.target.checked)}
                  className="w-3.5 h-3.5 accent-court-green"
                />
                Allow multiple answers
              </label>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setPollMode(false); setPollQuestion(""); setPollOptions(["", ""]); setPollIsMulti(false); }}
                className="btn-secondary flex-1 py-2 text-sm"
                disabled={pollSending}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={sendPoll}
                disabled={pollSending || !pollQuestion.trim() || pollOptions.map((o) => o.trim()).filter(Boolean).length < 2}
                className="btn-primary flex-1 py-2 text-sm"
              >
                {pollSending ? "Posting..." : "Post poll"}
              </button>
            </div>
          </div>
        )}
        {sendError && <p className="text-xs text-red-500 mb-2">{sendError}</p>}
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
          {groupInfo && (
            <ChatFindPlayerButton
              chatTarget={{ kind: "team", groupId, name: groupInfo.name }}
              onPosted={loadMessages}
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
            placeholder={`Message ${groupInfo?.name || "group"}...`}
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-full text-sm bg-surface/50 focus:bg-white transition-colors"
          />
          <EmojiPicker open={emojiOpen} onOpenChange={setEmojiOpen} onSelect={insertEmoji} />
          <button
            // Keep the OSK up on send — see chat/group/[chatId]/page.tsx for
            // the full rationale. Tapping a <button> on iOS WKWebView would
            // otherwise shift focus from the input to the button and dismiss
            // the keyboard.
            onMouseDown={(e) => e.preventDefault()}
            onTouchStart={(e) => e.preventDefault()}
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
