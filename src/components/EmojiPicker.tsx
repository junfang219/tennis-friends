"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const EMOJI_CATEGORIES = [
  {
    id: "tennis",
    icon: "🎾",
    label: "Tennis",
    emojis: [
      "🎾","🏆","🥇","🥈","🥉","🏅","🎖️","🏟️",
      "⛹️","⛹️‍♀️","⛹️‍♂️","🏃","🏃‍♀️","🏃‍♂️","💪","🔥",
      "⚡","💥","🎯","🎽","🩳","🧢","🥤","💧",
      "☀️","🌤️","🌧️","⏱️",
    ],
  },
  {
    id: "smileys",
    icon: "😀",
    label: "Smileys",
    emojis: [
      "😀","😃","😄","😁","😆","😅","😂","🤣",
      "😊","😇","🙂","🙃","😉","😌","😍","🥰",
      "😘","😋","😎","🤩","🥳","😏","🤔","😐",
      "😑","😶","🙄","😬","😴","🤤","🥱","😪",
      "😵","🤯","🤠","🤡","🥶","🥵","🤒","🤕",
      "🤧","😷",
    ],
  },
  {
    id: "hearts",
    icon: "❤️",
    label: "Hearts",
    emojis: [
      "❤️","🧡","💛","💚","💙","💜","🖤","🤍",
      "🤎","💔","❣️","💕","💞","💓","💗","💖",
      "💘","💝","💟","💌",
    ],
  },
  {
    id: "hands",
    icon: "👍",
    label: "Hands",
    emojis: [
      "👍","👎","👌","✌️","🤞","🤟","🤘","🤙",
      "👈","👉","👆","👇","☝️","✋","🤚","🖐️",
      "🖖","👋","🤝","🙏","👏","🙌","💪","🤛",
      "🤜","👊","✊",
    ],
  },
  {
    id: "fun",
    icon: "🎉",
    label: "Fun",
    emojis: [
      "🎉","🎊","🎈","🎁","🎀","🥂","🍻","🍕",
      "🍔","🌟","✨","💯","✅","❌","⭐","🌈",
      "🚀","💎","🎵","🎶","📸","🎥","☕","🍺",
      "🍷","🥗",
    ],
  },
] as const;

type CategoryId = (typeof EMOJI_CATEGORIES)[number]["id"];

export default function EmojiPicker({
  open,
  onOpenChange,
  onSelect,
  align = "right",
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSelect: (emoji: string) => void;
  align?: "left" | "right";
}) {
  const [activeCategory, setActiveCategory] = useState<CategoryId>("tennis");
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null);

  // Position the popup using fixed coords so it escapes any overflow:hidden parents.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const POPUP_W = 288; // w-72
    const POPUP_H = 280; // approx height of picker
    const GAP = 8;
    const update = () => {
      const rect = buttonRef.current!.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Prefer above the button; flip below if not enough room.
      let top = rect.top - POPUP_H - GAP;
      if (top < 8) top = Math.min(rect.bottom + GAP, vh - POPUP_H - 8);
      // Align right edge to button right (for align="right"), left edge for "left".
      let left = align === "right" ? rect.right - POPUP_W : rect.left;
      if (left < 8) left = 8;
      if (left + POPUP_W > vw - 8) left = vw - POPUP_W - 8;
      setPopupPos({ top, left });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, align]);

  // Outside-click close (covers both trigger container and portal popup)
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      onOpenChange(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open, onOpenChange]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    function handle(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [open, onOpenChange]);

  const active = EMOJI_CATEGORIES.find((c) => c.id === activeCategory) || EMOJI_CATEGORIES[0];

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => onOpenChange(!open)}
        className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors shrink-0 ${
          open
            ? "bg-court-green-pale/40 text-court-green"
            : "bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
        }`}
        title="Emoji"
        aria-label="Emoji picker"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M8 14s1.5 2 4 2 4-2 4-2" />
          <line x1="9" y1="9" x2="9.01" y2="9" />
          <line x1="15" y1="9" x2="15.01" y2="9" />
        </svg>
      </button>

      {open && popupPos && typeof window !== "undefined" && createPortal(
        <div
          ref={popupRef}
          style={{ position: "fixed", top: popupPos.top, left: popupPos.left, width: 288 }}
          className="z-[10001] bg-white rounded-2xl shadow-2xl border border-court-green-pale/30 p-3 animate-fade-in-up"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Category tabs */}
          <div className="flex items-center gap-1 border-b border-gray-100 mb-2 pb-2">
            {EMOJI_CATEGORIES.map((cat) => {
              const isActive = cat.id === activeCategory;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  className={`flex-1 py-1.5 rounded-lg text-xl transition-all ${
                    isActive
                      ? "bg-court-green/10 ring-1 ring-court-green-pale scale-110"
                      : "hover:bg-gray-50"
                  }`}
                  title={cat.label}
                  aria-label={cat.label}
                >
                  {cat.icon}
                </button>
              );
            })}
          </div>

          {/* Emoji grid */}
          <div className="grid grid-cols-8 gap-1 max-h-52 overflow-y-auto">
            {active.emojis.map((emoji, i) => (
              <button
                key={`${active.id}-${i}`}
                type="button"
                onClick={() => onSelect(emoji)}
                className="aspect-square text-2xl rounded-lg hover:bg-court-green-pale/30 hover:scale-125 transition-all flex items-center justify-center"
              >
                {emoji}
              </button>
            ))}
          </div>

          {/* Footer */}
          <div className="text-[10px] text-gray-400 text-center mt-2 pt-2 border-t border-gray-100">
            {active.label}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
