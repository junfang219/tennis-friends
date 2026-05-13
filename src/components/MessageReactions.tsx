"use client";

import { useState } from "react";
import { emojiFor } from "@/lib/reactions";

export type MessageReaction = {
  emoji: string;
  userId: string;
  userName: string;
};

type Props = {
  reactions: MessageReaction[];
  myUserId: string;
  // Align chips toward the bubble edge — bottom-right for own messages, bottom-left for others'.
  align: "left" | "right";
  // Quick-toggle on chip tap: caller decides whether to set or clear.
  onToggle: (emojiKey: string) => void;
};

// Compact strip of reaction chips pinned under a message bubble. Reactions are grouped by
// emoji key; chips show the count when >1. Tapping a chip toggles that reaction for the
// current user (matches iMessage). Long-press / hover briefly shows who reacted.
export default function MessageReactions({ reactions, myUserId, align, onToggle }: Props) {
  const [showWho, setShowWho] = useState<string | null>(null);

  if (reactions.length === 0) return null;

  // Group by emoji key, preserving order of first appearance.
  const grouped = new Map<string, MessageReaction[]>();
  for (const r of reactions) {
    const list = grouped.get(r.emoji) || [];
    list.push(r);
    grouped.set(r.emoji, list);
  }

  return (
    <div
      data-no-long-press
      className={`flex flex-wrap gap-1 mt-1 ${align === "right" ? "justify-end" : "justify-start"}`}
    >
      {Array.from(grouped.entries()).map(([emojiKey, list]) => {
        const mine = list.some((r) => r.userId === myUserId);
        const symbol = emojiFor(emojiKey) || emojiKey;
        const names = list.map((r) => r.userName).join(", ");
        const isOpen = showWho === emojiKey;
        return (
          <button
            key={emojiKey}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(emojiKey);
            }}
            onMouseEnter={() => setShowWho(emojiKey)}
            onMouseLeave={() => setShowWho((s) => (s === emojiKey ? null : s))}
            className={`relative inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[13px] leading-none border transition-colors ${
              mine
                ? "bg-court-green/15 border-court-green-soft text-court-green"
                : "bg-white/95 border-gray-200 text-gray-700 hover:bg-gray-50"
            }`}
            aria-label={`${list.length} ${symbol} reaction${list.length === 1 ? "" : "s"}: ${names}`}
            title={names}
          >
            <span aria-hidden="true">{symbol}</span>
            {list.length > 1 && (
              <span className="text-[11px] font-semibold tabular-nums">{list.length}</span>
            )}
            {isOpen && (
              <span className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap bg-gray-900 text-white text-[10px] px-2 py-0.5 rounded shadow-lg pointer-events-none">
                {names}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
