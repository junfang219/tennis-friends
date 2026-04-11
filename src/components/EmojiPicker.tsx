"use client";

import { useEffect, useRef, useState } from "react";

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

  // Outside-click close
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
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

      {open && (
        <div
          className={`absolute bottom-12 ${align === "right" ? "right-0" : "left-0"} z-[60] w-72 bg-white rounded-2xl shadow-2xl border border-court-green-pale/30 p-3 animate-fade-in-up`}
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
        </div>
      )}
    </div>
  );
}
