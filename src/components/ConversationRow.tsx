"use client";

import { useRef, useState, useCallback } from "react";
import Avatar from "./Avatar";

// ── Shared types (imported by MessageBell and /chat/page.tsx) ─────────────

export type DirectItem = {
  type: "direct";
  id: string;
  title: string;
  avatarUser: { id: string; name: string; profileImageUrl: string };
  lastMessage: { content: string; createdAt: string; fromSelf: boolean } | null;
  unreadCount: number;
  muted: boolean;
  pinnedAt: string | null;
  href: string;
};

export type GroupItem = {
  type: "group";
  id: string;
  title: string;
  participants: { id: string; name: string; profileImageUrl: string }[];
  lastMessage: { content: string; createdAt: string; fromSelf: boolean; senderName: string } | null;
  unreadCount: number;
  muted: boolean;
  pinnedAt: string | null;
  href: string;
  kind?: "session" | "group";
  sessionEndAt?: string | null;
};

export type TeamItem = {
  type: "team";
  id: string;
  title: string;
  participants: { id: string; name: string; profileImageUrl: string }[];
  imageUrl?: string;
  lastMessage: { content: string; createdAt: string; fromSelf: boolean; senderName: string } | null;
  unreadCount: number;
  muted: boolean;
  pinnedAt: string | null;
  href: string;
  /** If set, this group is the backing chat for an event — render with the Event badge. */
  eventId?: string | null;
};

export type InboxItem = DirectItem | GroupItem | TeamItem;

export type InboxAction = "markUnread" | "pin" | "unpin" | "mute" | "unmute" | "hide";

function timeAgo(date: string) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Component ─────────────────────────────────────────────────────────────

type Props = {
  item: InboxItem;
  /** Parent tracks a single "open" row key and passes true/false here. */
  isOpen: boolean;
  /** Parent sets this row as the active-open row (closes any other). */
  onOpen: () => void;
  /** Parent clears the active-open row. */
  onClose: () => void;
  /** Row body tap (no drag) → open the conversation. */
  onSelect: () => void;
  /** Swipe action tapped. Parent handles the API call + optimistic state. */
  onAction: (action: InboxAction) => void;
  layout?: "dropdown" | "page";
  /** Desktop two-pane: highlight this row as the currently-open conversation. */
  isSelected?: boolean;
};

// Action panel widths. Small on the 320px dropdown, slightly wider with labels on the /chat page.
// Kept narrow so the conversation content remains visible alongside the actions on small phones.
const BUTTON_W_DROPDOWN = 56;
const BUTTON_W_PAGE = 60;
const TAP_THRESHOLD_PX = 6; // move less than this = treat as tap

export default function ConversationRow({
  item,
  isOpen,
  onOpen,
  onClose,
  onSelect,
  onAction,
  layout = "dropdown",
  isSelected = false,
}: Props) {
  const buttonW = layout === "page" ? BUTTON_W_PAGE : BUTTON_W_DROPDOWN;
  const ACTIONS_WIDTH = buttonW * 4;
  const OPEN_THRESHOLD = ACTIONS_WIDTH / 2;

  // `isDrag` = pointer committed to a horizontal swipe (locks vertical scroll
  // and engages the action panel). `movedBeyondTap` = pointer moved enough in
  // *any* direction that this gesture is no longer a tap. The two are
  // distinct: a vertical scroll sets movedBeyondTap=true but leaves isDrag
  // false — so on lift we neither open the chat nor reveal swipe actions.
  // Matches iPhone Messages: scroll past a row, lift, no chat opens.
  const [drag, setDrag] = useState<{
    startX: number;
    startY: number;
    dx: number;
    active: boolean;
    isDrag: boolean;
    movedBeyondTap: boolean;
  } | null>(null);
  // Local override: when an action is tapped, force the row closed immediately
  // regardless of parent state so the animation plays and actions don't stay overlapped.
  const [forceClosed, setForceClosed] = useState(false);
  const foregroundRef = useRef<HTMLDivElement>(null);

  // Tapping any action triggers a local force-close. Parent will also set openRowKey=null
  // but we don't rely on that timing here — this ensures an immediate visual snap-back.
  const handleActionTap = useCallback(
    (action: InboxAction) => {
      setDrag(null);
      setForceClosed(true);
      onAction(action);
      // Once the parent commits openRowKey=null, `isOpen` will be false,
      // so we can safely drop the override on the next tick after the CSS transition settles.
      setTimeout(() => setForceClosed(false), 260);
    },
    [onAction],
  );

  // Current translateX: during drag it follows dx; otherwise it's -ACTIONS_WIDTH if open, 0 if closed.
  const translateX = forceClosed
    ? 0
    : drag?.active
    ? Math.max(-ACTIONS_WIDTH, Math.min(0, (isOpen ? -ACTIONS_WIDTH : 0) + drag.dx))
    : isOpen
    ? -ACTIONS_WIDTH
    : 0;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Ignore gestures starting inside an action button (let the button handle the click)
    const target = e.target as HTMLElement;
    if (target.closest("[data-swipe-action]")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      active: true,
      isDrag: false,
      movedBeyondTap: false,
    });
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag?.active) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const isHorizontalIntent = Math.abs(dx) > Math.abs(dy) + 4;
    // Any movement past the tap threshold in *either* axis disqualifies the
    // gesture from being a tap — even if it never becomes a horizontal swipe.
    // Without this, a vertical scroll on the list opens whatever chat the
    // finger happened to lift over (the iOS-Messages footgun).
    const movedBeyondTap =
      Math.abs(dx) > TAP_THRESHOLD_PX || Math.abs(dy) > TAP_THRESHOLD_PX;
    if (!drag.isDrag && Math.abs(dx) > TAP_THRESHOLD_PX && isHorizontalIntent) {
      setDrag((d) => (d ? { ...d, isDrag: true } : d));
    }
    // Prevent vertical scroll once we've committed to a horizontal drag
    if (drag.isDrag) e.preventDefault();
    setDrag((d) =>
      d ? { ...d, dx, movedBeyondTap: d.movedBeyondTap || movedBeyondTap } : d
    );
  }, [drag]);

  const handlePointerUp = useCallback(() => {
    if (!drag) return;
    const wasDrag = drag.isDrag;
    const finalOffset = (isOpen ? -ACTIONS_WIDTH : 0) + drag.dx;

    if (wasDrag) {
      // Past the halfway point of actions width = open. Otherwise closed.
      if (finalOffset < -OPEN_THRESHOLD) {
        onOpen();
      } else {
        onClose();
      }
    } else if (!drag.movedBeyondTap) {
      // Genuine tap — no movement in any direction past the threshold.
      // If row is currently open, close it; otherwise select.
      if (isOpen) onClose();
      else onSelect();
    }
    // else: finger moved (scrolling, or a swipe that didn't commit). Don't
    // open the chat and don't toggle the actions — let the native scroll
    // handle itself.
    setDrag(null);
  }, [drag, isOpen, ACTIONS_WIDTH, OPEN_THRESHOLD, onOpen, onClose, onSelect]);

  // Foreground background must be OPAQUE so the action panel behind doesn't bleed through on iOS.
  // For unread items we use a solid pale tint instead of a translucent overlay.
  const isSession = item.type === "group" && item.kind === "session";
  const isTeam = item.type === "team";
  const rowBg = isSelected
    ? "bg-[#D6EAD3]"
    : isSession
    ? item.unreadCount > 0
      ? "bg-[#E3F1E1]"
      : "bg-[#EFF7ED]"
    : isTeam
    ? item.unreadCount > 0
      ? "bg-[#F7E6D4]"
      : "bg-[#FDF5ED]"
    : item.unreadCount > 0
    ? "bg-[#F1F7F0]"
    : "bg-white";
  const rowPadding = layout === "page" ? "px-4 py-4" : "px-4 py-3";
  // When selected, the left accent always shows court-green regardless of item type
  // (mirrors Instagram's "active thread" indicator). Otherwise keep the per-type accent.
  const sideBorder = isSelected
    ? "border-l-4 border-l-court-green"
    : isSession
    ? "border-l-4 border-l-court-green"
    : isTeam
    ? "border-l-4 border-l-clay"
    : "";

  return (
    <div className="relative overflow-hidden touch-pan-y">
      {/* Background action buttons — always there, revealed when foreground slides */}
      <div
        className="absolute inset-y-0 right-0 flex items-stretch z-0"
        style={{ width: ACTIONS_WIDTH }}
        aria-hidden={!isOpen}
      >
        <ActionButton
          label="Unread"
          color="bg-blue-500"
          width={buttonW}
          layout={layout}
          onClick={() => handleActionTap("markUnread")}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <circle cx="12" cy="12" r="3" fill="currentColor" />
            </svg>
          }
        />
        <ActionButton
          label={item.pinnedAt ? "Unpin" : "Pin"}
          color="bg-amber-500"
          width={buttonW}
          layout={layout}
          onClick={() => handleActionTap(item.pinnedAt ? "unpin" : "pin")}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 17v5" />
              <path d="M9 10.76V6h6v4.76a2 2 0 00.586 1.414l2 2A2 2 0 0118 15.586V17H6v-1.414a2 2 0 01.414-1.414l2-2A2 2 0 009 10.76z" />
            </svg>
          }
        />
        <ActionButton
          label={item.muted ? "Unmute" : "Mute"}
          color="bg-gray-500"
          width={buttonW}
          layout={layout}
          onClick={() => handleActionTap(item.muted ? "unmute" : "mute")}
          icon={
            item.muted ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 01-3.46 0" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13.73 21a2 2 0 01-3.46 0" />
                <path d="M18.63 13A17.89 17.89 0 0118 8" />
                <path d="M6.26 6.26A5.86 5.86 0 006 8c0 7-3 9-3 9h14" />
                <path d="M18 8a6 6 0 00-9.33-5" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            )
          }
        />
        <ActionButton
          label="Remove"
          color="bg-red-500"
          width={buttonW}
          layout={layout}
          onClick={() => handleActionTap("hide")}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3,6 5,6 21,6" />
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a2 2 0 012-2h2a2 2 0 012 2v2" />
            </svg>
          }
        />
      </div>

      {/* Foreground row — the actual conversation content, slides left on swipe */}
      <div
        ref={foregroundRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`group relative z-10 ${rowBg} ${sideBorder} ${rowPadding} flex items-center gap-3 cursor-pointer select-none`}
        style={{
          transform: `translateX(${translateX}px)`,
          transition: drag?.active ? "none" : "transform 220ms ease",
          touchAction: "pan-y",
          willChange: "transform",
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (isOpen) onClose();
            else onSelect();
          } else if (e.key === "Escape" && isOpen) {
            onClose();
          }
        }}
      >
        <div className="shrink-0 relative">
          {item.type === "direct" ? (
            <Avatar name={item.avatarUser.name} image={item.avatarUser.profileImageUrl} size={layout === "page" ? "lg" : "md"} />
          ) : item.type === "team" ? (
            <div className="relative">
              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt={item.title}
                  className={`${layout === "page" ? "w-12 h-12" : "w-10 h-10"} rounded-xl object-cover shadow-sm`}
                />
              ) : item.eventId ? (
                <div className={`${layout === "page" ? "w-12 h-12 text-lg" : "w-10 h-10 text-sm"} rounded-xl bg-gradient-to-br from-court-green-soft to-court-green flex items-center justify-center text-white font-bold shadow-sm`}>
                  {item.title.charAt(0).toUpperCase()}
                </div>
              ) : (
                <div className={`${layout === "page" ? "w-12 h-12 text-lg" : "w-10 h-10 text-sm"} rounded-xl bg-gradient-to-br from-clay to-clay-light flex items-center justify-center text-white font-bold shadow-sm`}>
                  {item.title.charAt(0).toUpperCase()}
                </div>
              )}
              {item.eventId ? (
                <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-ball-yellow flex items-center justify-center">
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-court-green">
                    <ellipse cx="7" cy="6.5" rx="3" ry="4" transform="rotate(-25 7 6.5)" />
                    <line x1="9" y1="9.5" x2="17" y2="21.5" />
                    <ellipse cx="17" cy="6.5" rx="3" ry="4" transform="rotate(25 17 6.5)" />
                    <line x1="15" y1="9.5" x2="7" y2="21.5" />
                  </svg>
                </span>
              ) : (
                <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-clay flex items-center justify-center">
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                    <path d="M6 9H4.5a2.5 2.5 0 010-5H6" />
                    <path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
                    <path d="M4 22h16" />
                    <path d="M18 2H6v7a6 6 0 0012 0V2z" />
                  </svg>
                </span>
              )}
            </div>
          ) : (
            <div className="flex -space-x-3">
              {item.participants.slice(0, 2).map((p) => (
                <Avatar key={p.id} name={p.name} image={p.profileImageUrl} size="sm" />
              ))}
            </div>
          )}
          {item.pinnedAt && (
            <span
              className="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center shadow-sm"
              title="Pinned"
              aria-label="Pinned"
            >
              <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" className="text-white">
                <path d="M12 2l2 7h7l-5.5 4.5L17 21l-5-3.5L7 21l1.5-7.5L3 9h7z" />
              </svg>
            </span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className={`text-sm truncate ${item.unreadCount > 0 ? "font-bold text-gray-900" : "font-semibold text-gray-800"}`}>
              {item.title}
              {item.type === "team" && item.eventId ? (
                <span className="ml-1.5 text-[9px] font-bold tracking-wider text-court-green bg-ball-yellow/60 px-1 py-0.5 rounded uppercase">
                  Event
                </span>
              ) : item.type === "team" ? (
                <span className="ml-1.5 text-[9px] font-bold tracking-wider text-clay bg-clay/15 px-1 py-0.5 rounded uppercase">
                  Team
                </span>
              ) : null}
              {isSession && (
                <span className="ml-1.5 text-[9px] font-bold tracking-wider text-white bg-court-green px-1.5 py-0.5 rounded uppercase">
                  🎾 Game
                </span>
              )}
              {item.muted && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="inline-block ml-1.5 text-gray-400 align-middle" strokeLinecap="round" strokeLinejoin="round" aria-label="Muted">
                  <path d="M13.73 21a2 2 0 01-3.46 0" />
                  <path d="M18.63 13A17.89 17.89 0 0118 8" />
                  <path d="M6.26 6.26A5.86 5.86 0 006 8c0 7-3 9-3 9h14" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              )}
            </p>
            <span className={`text-[10px] text-gray-400 shrink-0 transition-opacity md:group-hover:opacity-0 ${layout === "page" ? "text-xs" : ""}`}>
              {item.lastMessage ? timeAgo(item.lastMessage.createdAt) : ""}
            </span>
          </div>
          <p className={`${layout === "page" ? "text-sm" : "text-xs"} truncate mt-0.5 ${item.unreadCount > 0 ? "text-gray-700 font-medium" : "text-gray-500"}`}>
            {item.lastMessage
              ? `${item.lastMessage.fromSelf ? "You" : item.type === "group" || item.type === "team" ? item.lastMessage.senderName : ""}${item.lastMessage.fromSelf || item.type === "group" || item.type === "team" ? ": " : ""}${item.lastMessage.content || "(no text)"}`
              : "No messages yet"}
          </p>
        </div>

        {item.unreadCount > 0 && !item.muted && (
          <span className={`shrink-0 bg-court-green text-white text-[10px] font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5 ${layout === "page" ? "min-w-[22px] h-[22px] text-xs" : ""}`}>
            {item.unreadCount > 99 ? "99+" : item.unreadCount}
          </span>
        )}
        {/* Desktop-only hover X for the Remove action. Touch users get
            the full swipe panel (Unread / Pin / Mute / Remove). Marked
            with data-swipe-action so the pointer-down handler ignores
            taps on this button. */}
        <button
          data-swipe-action
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); handleActionTap("hide"); }}
          aria-label="Remove conversation"
          title="Remove"
          className={`hidden md:flex absolute top-2 right-2 z-20 w-7 h-7 items-center justify-center rounded-full bg-gray-200 text-gray-700 shadow-md hover:bg-red-500 hover:text-white transition-opacity ${isOpen ? "opacity-0 pointer-events-none" : "opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function ActionButton({
  label,
  color,
  width,
  icon,
  onClick,
  layout,
}: {
  label: string;
  color: string;
  width: number;
  icon: React.ReactNode;
  onClick: () => void;
  layout: "dropdown" | "page";
}) {
  return (
    <button
      data-swipe-action
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={label}
      title={label}
      style={{ width }}
      className={`${color} text-white flex flex-col items-center justify-center gap-1 active:brightness-90 transition-all`}
    >
      {icon}
      {layout === "page" && <span className="text-[10px] font-semibold">{label}</span>}
    </button>
  );
}
