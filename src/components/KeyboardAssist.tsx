"use client";

import { useCallback, useEffect, useRef } from "react";
import { useKeyboardHeight } from "@/hooks/useKeyboardHeight";

// Global keyboard ergonomics for dense forms (Create Post, create event,
// onboarding, create team, …). Mounted once in the root layout next to
// KeyboardInit. Because capacitor.config uses resize: "none", the WebView is
// NOT shrunk when the keyboard opens — the keyboard just overlays the bottom of
// the screen — so without this, lower fields hide behind the keyboard and the
// only way to dismiss is to tap empty space (which in a field-dense form keeps
// landing on another input). This wires three complementary behaviors:
//
//   1. Scroll-to-dismiss — drag to scroll drops the keyboard (iOS
//      keyboardDismissMode = .onDrag).
//   2. Focus-into-view — a freshly focused field scrolls to center once the
//      keyboard has opened.
//   3. Bottom scroll room — body gets padding-bottom = keyboard height so the
//      LAST field in a page-flow form can rise above the keyboard.
//
// Anything inside a [data-keyboard-dismiss="off"] subtree is skipped — chat
// opts out so it keeps its own keyboard-anchored input bar and its "scroll
// history with the keyboard up" behavior. Behavior-only — renders nothing.

const DRAG_THRESHOLD = 8; // px of vertical drag before we treat it as a scroll

function isEditable(el: EventTarget | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.tagName === "TEXTAREA") return true;
  if (el.tagName === "INPUT") {
    const type = (el as HTMLInputElement).type;
    // Only text-entry inputs raise a keyboard; checkbox/radio/etc. don't.
    return ![
      "checkbox",
      "radio",
      "button",
      "submit",
      "reset",
      "file",
      "range",
      "color",
      "image",
    ].includes(type);
  }
  return el.isContentEditable;
}

function isOptedOut(el: EventTarget | null): boolean {
  return (
    el instanceof Element &&
    el.closest('[data-keyboard-dismiss="off"]') !== null
  );
}

export default function KeyboardAssist() {
  const keyboardHeight = useKeyboardHeight();

  // Latest keyboard height read inside listeners/timeouts without re-binding.
  const kbRef = useRef(0);
  kbRef.current = keyboardHeight;

  // Native keyboard dismissal. In the Capacitor WKWebView, blur() alone does
  // NOT reliably drop the keyboard — the WebView must resignFirstResponder,
  // which is what @capacitor/keyboard's Keyboard.hide() does. Load it once on
  // native and stash the call so the drag handler can fire it synchronously.
  const nativeHideRef = useRef<null | (() => void)>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const core = await import("@capacitor/core");
        if (cancelled || !core.Capacitor.isNativePlatform()) return;
        const { Keyboard } = await import("@capacitor/keyboard");
        if (cancelled) return;
        nativeHideRef.current = () => {
          Keyboard.hide().catch(() => {});
        };
      } catch {
        // Not in the native shell — blur() handles web.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Stable across renders (reads refs/DOM only) so the touch effect can close
  // over it once. blur() covers web; Keyboard.hide() forces it on native.
  const dismissKeyboard = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    nativeHideRef.current?.();
  }, []);

  // (3) Bottom scroll room on the page scroll root.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const body = document.body;
    body.style.paddingBottom = keyboardHeight > 0 ? `${keyboardHeight}px` : "";
    return () => {
      body.style.paddingBottom = "";
    };
  }, [keyboardHeight]);

  // (1) Scroll-to-dismiss + (2) focus-into-view.
  useEffect(() => {
    if (typeof document === "undefined") return;

    let startY = 0;
    let dismissedThisGesture = false;

    const onTouchStart = (e: TouchEvent) => {
      startY = e.touches[0]?.clientY ?? 0;
      dismissedThisGesture = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (dismissedThisGesture) return;
      const active = document.activeElement;
      if (!isEditable(active)) return;
      const y = e.touches[0]?.clientY ?? startY;
      if (Math.abs(y - startY) < DRAG_THRESHOLD) return;
      // Dragging *inside* a textarea that can scroll its own overflow (to pan
      // its content) shouldn't dismiss it. A single-line input — or a textarea
      // with nothing to scroll — has no internal scroll, so a drag starting on
      // it should still dismiss the keyboard.
      if (
        active instanceof HTMLTextAreaElement &&
        active.scrollHeight > active.clientHeight &&
        active.contains(e.target as Node)
      )
        return;
      if (isOptedOut(e.target) || isOptedOut(active)) return;
      dismissKeyboard();
      dismissedThisGesture = true;
    };

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (!isEditable(target) || isOptedOut(target)) return;
      // Wait for the keyboard to animate open, then center the field. Gated on
      // a non-zero keyboard height so desktop (no on-screen keyboard) is inert.
      window.setTimeout(() => {
        if (kbRef.current > 0 && document.activeElement === target) {
          (target as HTMLElement).scrollIntoView({
            block: "center",
            behavior: "smooth",
          });
        }
      }, 300);
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [dismissKeyboard]);

  return null;
}
