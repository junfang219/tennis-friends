"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// The captain's "Send" control on each match in the Matches tab. Tapping it
// opens a dropdown with two destinations for the same generated lineup text:
// post it to the in-app team chat, or hand it to the native iOS share sheet
// (Messages / iMessage). Modeled on CoverEditMenu — the panel is portaled to
// <body> and fixed-positioned because the match cell clips overflow.

interface SendLineupMenuProps {
  /** Whether any player is assigned to a slot; disables the trigger when false. */
  hasLineup: boolean;
  /** A chat post is in flight — shows "..." and blocks re-taps. */
  sending: boolean;
  /** The lineup was just posted to chat — shows the check-mark + "Sent". */
  justSent: boolean;
  onPostToChat: () => void;
  onSendViaMessages: () => void;
}

const PANEL_WIDTH = 184; // w-46-ish

export default function SendLineupMenu({
  hasLineup,
  sending,
  justSent,
  onPostToChat,
  onSendViaMessages,
}: SendLineupMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Anchor the portaled panel just below the trigger, right-aligned.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.right - PANEL_WIDTH });
  }, [open]);

  // Click-outside + Escape to close. The panel is portaled outside the button's
  // subtree, so check both refs explicitly.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={!hasLineup || sending}
        className={`text-[10px] font-semibold px-2 py-1 rounded-md inline-flex items-center gap-1 transition-colors ${
          justSent
            ? "bg-green-100 text-green-700"
            : hasLineup
            ? "bg-court-green text-white hover:bg-court-green-light"
            : "bg-gray-100 text-gray-400 cursor-not-allowed"
        }`}
        title="Send lineup"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {sending ? (
          "..."
        ) : justSent ? (
          <>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20,6 9,17 4,12" />
            </svg>
            Sent
          </>
        ) : (
          <>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
            Send
          </>
        )}
      </button>

      {open && pos &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            style={{ position: "fixed", top: pos.top, left: pos.left, width: PANEL_WIDTH }}
            className="z-50 bg-white rounded-xl shadow-lg border border-gray-200 py-1"
          >
            <button
              role="menuitem"
              onClick={() => {
                close();
                onPostToChat();
              }}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              Post to team chat
            </button>
            <button
              role="menuitem"
              onClick={() => {
                close();
                onSendViaMessages();
              }}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
              Send via iMessage
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
