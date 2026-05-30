"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Cover-photo edit control shared by the profile and team headers. Replaces
// the old pair of floating icons (camera + pencil) with a single button that
// opens a dropdown — "Change cover photo" and, once a cover exists,
// "Reposition". Sits bottom-right of the banner.
//
// The dropdown panel is portaled to <body> and positioned with fixed
// coordinates: the banner uses overflow-hidden (to clip the zoomable cover
// image), which would otherwise clip a menu rendered inside it.
interface CoverEditMenuProps {
  /** Open the file picker to upload a new cover. */
  onChangePhoto: () => void;
  /** Enter reposition/zoom mode. Omit when there's no cover image yet. */
  onReposition?: () => void;
  /** Show a spinner + disable the trigger while an upload is in flight. */
  uploading?: boolean;
}

const PANEL_WIDTH = 176; // w-44

export default function CoverEditMenu({
  onChangePhoto,
  onReposition,
  uploading,
}: CoverEditMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Anchor the portaled panel just below the trigger, right-aligned.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 8, left: r.right - PANEL_WIDTH });
  }, [open]);

  // Click-outside + Escape to close. The panel is portaled outside the
  // button's subtree, so check both refs explicitly.
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

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={uploading}
        className="absolute bottom-3 right-3 z-10 w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur text-white flex items-center justify-center transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        title="Edit cover"
        aria-label="Edit cover"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {uploading ? (
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
            <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
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
                setOpen(false);
                onChangePhoto();
              }}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              Change photo
            </button>
            {onReposition && (
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onReposition();
                }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Reposition
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
