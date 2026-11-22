"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { REACTIONS, type ReactionKey } from "@/lib/reactions";
import { ReportContentDialog, ReportFlag, type ReportContentTarget } from "./ReportContent";

const BAR_H = 56;
const GAP = 10;
const EMOJI_BAR_W = 280;
const ACTION_EXTRA_W = 56;

type Props = {
  anchorRect: DOMRect | null;
  currentReaction: ReactionKey | null;
  onSelect: (key: ReactionKey | null) => void;
  onClose: () => void;
  // Optional. Only passed for messages the viewer authored. When provided
  // the bar grows by ~56px to fit a divider + trash button.
  onDelete?: () => void;
  reportTarget?: ReportContentTarget;
};

function reactionBarPosition(anchor: DOMRect, width: number, viewportWidth: number, viewportHeight: number) {
  const above = anchor.top - BAR_H - GAP;
  const top = above < 8 ? Math.min(anchor.bottom + GAP, viewportHeight - BAR_H - 8) : above;
  const visibleWidth = Math.min(width, viewportWidth - 16);
  const centered = anchor.left + (anchor.width - visibleWidth) / 2;
  const left = Math.max(8, Math.min(centered, viewportWidth - visibleWidth - 8));
  return { top, left };
}

// Popover bar of 6 emoji reactions, anchored above the message bubble (flips below when there
// isn't room). Tapping the user's current reaction sends null (toggle off); tapping any other
// reaction replaces. createPortal mirrors the pattern in EmojiPicker.tsx so the bar escapes
// the chat scroll container.
export default function MessageReactionBar({ anchorRect, currentReaction, onSelect, onClose, onDelete, reportTarget }: Props) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [report, setReport] = useState<ReportContentTarget | null>(null);
  const barWidth = EMOJI_BAR_W + (onDelete || reportTarget ? ACTION_EXTRA_W : 0);

  useEffect(() => {
    if (!anchorRect) return;
    function handleMouseDown(e: MouseEvent) {
      if (popupRef.current?.contains(e.target as Node)) return;
      onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function handleScroll() {
      onClose();
    }
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
    };
  }, [anchorRect, onClose]);

  const pos = anchorRect && typeof window !== "undefined"
    ? reactionBarPosition(anchorRect, barWidth, window.innerWidth, window.innerHeight)
    : null;
  const popover = pos ? createPortal(
    <div
      ref={popupRef}
      style={{ position: "fixed", top: pos.top, left: pos.left, width: barWidth, maxWidth: "calc(100vw - 16px)", height: BAR_H }}
      className="z-[10001] bg-white rounded-full shadow-2xl border border-gray-200 px-2 flex items-center justify-between animate-fade-in-up"
      onClick={(e) => e.stopPropagation()}
    >
      {REACTIONS.map((r) => {
        const active = currentReaction === r.key;
        return (
          <button
            key={r.key}
            type="button"
            onClick={() => onSelect(active ? null : r.key)}
            className={`w-10 h-10 rounded-full flex items-center justify-center text-2xl transition-transform hover:scale-125 active:scale-110 ${
              active ? "bg-court-green/15 ring-2 ring-court-green-soft scale-110" : "hover:bg-gray-100"
            }`}
            title={active ? `Remove ${r.label}` : r.label}
            aria-label={r.label}
          >
            <span aria-hidden="true">{r.emoji}</span>
          </button>
        );
      })}
      {reportTarget && (
        <button
          type="button"
          onClick={() => {
            setReport(reportTarget);
            onClose();
          }}
          className="inline-flex size-11 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100"
          aria-label="Report message"
          aria-haspopup="dialog"
          title="Report message"
        >
          <ReportFlag />
        </button>
      )}
      {onDelete && (
        <>
          <span className="h-7 w-px bg-gray-200 mx-1" aria-hidden="true" />
          <button
            type="button"
            onClick={onDelete}
            className="w-10 h-10 rounded-full flex items-center justify-center text-red-500 hover:bg-red-50 transition-colors"
            title="Delete message"
            aria-label="Delete message"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a2 2 0 012-2h2a2 2 0 012 2v2" />
            </svg>
          </button>
        </>
      )}
    </div>,
    document.body,
  ) : null;

  return <>{popover}{report && <ReportContentDialog target={report} onClose={() => setReport(null)} />}</>;
}
