"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Wraps a horizontally-scrollable element (e.g. a wide matrix table) and makes
 * the sideways scroll discoverable. A wide table on its own gives no hint that
 * columns are hidden off-screen, so users miss them — this adds:
 *   • a control bar with a "scroll" hint + ‹ › buttons, and
 *   • a fading gradient on whichever edge has hidden content,
 * all shown only while the content actually overflows.
 *
 * `className` styles the inner scroll container (pass the `overflow-x-auto`).
 * `frameClassName` styles the outer wrapper (e.g. `hidden md:block`).
 */
export default function HScrollFrame({
  children,
  className = "",
  frameClassName = "",
  hint = "Scroll to see more",
}: {
  children: ReactNode;
  className?: string;
  frameClassName?: string;
  hint?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 1);
    // Round up so sub-pixel widths don't leave the right arrow stuck "on".
    setCanRight(Math.ceil(el.scrollLeft + el.clientWidth) < el.scrollWidth);
  }, []);

  // Recompute after every render so adding/removing columns (which changes
  // scrollWidth without resizing the container) keeps the affordances accurate.
  useEffect(update);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [update]);

  const nudge = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.75), behavior: "smooth" });
  };

  const arrowBase =
    "w-7 h-7 rounded-full border border-gray-200 bg-white text-gray-600 flex items-center justify-center transition-colors hover:text-court-green hover:border-court-green disabled:opacity-30 disabled:hover:text-gray-600 disabled:hover:border-gray-200";

  return (
    <div className={frameClassName}>
      {(canLeft || canRight) && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
          <span className="mr-auto text-[11px] font-medium text-gray-400 inline-flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="2" y1="12" x2="22" y2="12" />
              <polyline points="6 8 2 12 6 16" />
              <polyline points="18 8 22 12 18 16" />
            </svg>
            {hint}
          </span>
          <button type="button" onClick={() => nudge(-1)} disabled={!canLeft} aria-label="Scroll left" className={arrowBase}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button type="button" onClick={() => nudge(1)} disabled={!canRight} aria-label="Scroll right" className={arrowBase}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      )}
      <div className="relative">
        <div ref={scrollRef} className={className}>
          {children}
        </div>
        {canRight && (
          <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-white to-transparent" />
        )}
      </div>
    </div>
  );
}
