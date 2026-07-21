"use client";

// Reusable portal popover menu: a caller-rendered trigger plus a panel of
// labeled rows (icon + title + optional subtitle), fixed-positioned below the
// trigger and right-aligned. Extracted from SendLineupMenu's hand-rolled
// dropdown so match menus, send menus, etc. share one look and behavior
// (outside-click + Escape close, viewport clamping, portal to <body> to
// escape overflow clipping).

import { ReactNode, RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ActionMenuItem {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  tone?: "default" | "danger";
  disabled?: boolean;
  onSelect: () => void;
}

export default function ActionMenu({
  trigger,
  header,
  items,
  width = 232,
}: {
  /** Render the trigger button; attach `ref` to it and call `toggle` on click. */
  trigger: (args: {
    ref: RefObject<HTMLButtonElement | null>;
    open: boolean;
    toggle: () => void;
  }) => ReactNode;
  /** Optional small uppercase label row at the top of the panel. */
  header?: string;
  items: ActionMenuItem[];
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Anchor just below the trigger, right-aligned, clamped to the viewport.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: Math.max(8, r.right - width) });
  }, [open, width]);

  // Click-outside + Escape to close. The panel is portaled outside the
  // trigger's subtree, so check both refs explicitly.
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
      {trigger({ ref: buttonRef, open, toggle: () => setOpen((o) => !o) })}

      {open && pos && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            style={{ position: "fixed", top: pos.top, left: pos.left, width }}
            className="z-50 bg-white rounded-xl shadow-2xl border border-gray-200 p-1.5"
          >
            {header && (
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-2.5 pt-1 pb-0.5">
                {header}
              </p>
            )}
            {items.map((item) => (
              <button
                key={item.title}
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span
                  className={`shrink-0 mt-0.5 ${item.tone === "danger" ? "text-red-500" : "text-court-green"}`}
                >
                  {item.icon}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block text-sm font-medium ${item.tone === "danger" ? "text-red-600" : "text-gray-800"}`}
                  >
                    {item.title}
                  </span>
                  {item.subtitle && (
                    <span className="block text-[11px] text-gray-500">{item.subtitle}</span>
                  )}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
