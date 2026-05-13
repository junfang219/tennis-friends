"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { REACTIONS, type ReactionKey } from "@/lib/reactions";

const BAR_W = 280;
const BAR_H = 56;
const GAP = 10;

type Props = {
  anchorRect: DOMRect | null;
  currentReaction: ReactionKey | null;
  onSelect: (key: ReactionKey | null) => void;
  onClose: () => void;
};

// Popover bar of 6 emoji reactions, anchored above the message bubble (flips below when there
// isn't room). Tapping the user's current reaction sends null (toggle off); tapping any other
// reaction replaces. createPortal mirrors the pattern in EmojiPicker.tsx so the bar escapes
// the chat scroll container.
export default function MessageReactionBar({ anchorRect, currentReaction, onSelect, onClose }: Props) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; placement: "above" | "below" } | null>(null);

  useLayoutEffect(() => {
    if (!anchorRect) {
      setPos(null);
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let placement: "above" | "below" = "above";
    let top = anchorRect.top - BAR_H - GAP;
    if (top < 8) {
      placement = "below";
      top = Math.min(anchorRect.bottom + GAP, vh - BAR_H - 8);
    }
    let left = anchorRect.left + anchorRect.width / 2 - BAR_W / 2;
    if (left < 8) left = 8;
    if (left + BAR_W > vw - 8) left = vw - BAR_W - 8;
    setPos({ top, left, placement });
  }, [anchorRect]);

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
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [anchorRect, onClose]);

  if (!anchorRect || !pos || typeof window === "undefined") return null;

  return createPortal(
    <div
      ref={popupRef}
      style={{ position: "fixed", top: pos.top, left: pos.left, width: BAR_W, height: BAR_H }}
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
    </div>,
    document.body,
  );
}
