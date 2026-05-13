"use client";

import { useCallback, useRef } from "react";

const LONG_PRESS_MS = 450;
const MOVE_THRESHOLD_PX = 8;

type LongPressHandlers = {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onPointerLeave: (e: React.PointerEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
};

// Long-press detector modeled on the pointer-event pattern in ConversationRow.tsx.
// Calls onLongPress with the bounding rect of the element the user pressed on,
// so callers can position a popover relative to the bubble. Cancels on movement
// > MOVE_THRESHOLD_PX (so vertical scroll doesn't trigger it) and on early release.
// onContextMenu fires immediately for desktop right-click parity.
export function useLongPress(
  onLongPress: (rect: DOMRect, target: HTMLElement) => void,
  enabled = true,
): LongPressHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number; target: HTMLElement } | null>(null);
  const triggeredRef = useRef(false);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled) return;
      // Don't capture inside reaction-chip buttons or other actionable controls inside the bubble
      const target = e.target as HTMLElement;
      if (target.closest("[data-no-long-press]")) return;
      if (target.closest("button, a")) {
        // Allow long-press on links/buttons we own (the bubble itself), but skip nested actionables.
        const own = target.closest("[data-long-press-root]");
        if (!own) return;
      }
      const root = (e.currentTarget as HTMLElement);
      triggeredRef.current = false;
      startRef.current = { x: e.clientX, y: e.clientY, target: root };
      timerRef.current = setTimeout(() => {
        if (!startRef.current) return;
        triggeredRef.current = true;
        const rect = root.getBoundingClientRect();
        onLongPress(rect, root);
        startRef.current = null;
        timerRef.current = null;
      }, LONG_PRESS_MS);
    },
    [enabled, onLongPress],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!startRef.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    if (Math.abs(dx) > MOVE_THRESHOLD_PX || Math.abs(dy) > MOVE_THRESHOLD_PX) {
      cancel();
    }
  }, [cancel]);

  const onPointerUp = useCallback((_e: React.PointerEvent) => {
    cancel();
  }, [cancel]);

  const onPointerCancel = useCallback(() => cancel(), [cancel]);
  const onPointerLeave = useCallback(() => cancel(), [cancel]);

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled) return;
      e.preventDefault();
      const root = e.currentTarget as HTMLElement;
      const rect = root.getBoundingClientRect();
      onLongPress(rect, root);
    },
    [enabled, onLongPress],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onPointerLeave,
    onContextMenu,
  };
}

export function wasLongPressTriggered(_: unknown): boolean {
  return false;
}
