"use client";

import { useEffect, useState } from "react";

/**
 * Returns the on-screen keyboard's height in CSS px (0 when closed).
 *
 * Two non-overlapping code paths, picked by Capacitor.isNativePlatform():
 *
 *  - Native (Capacitor): subscribe ONLY to @capacitor/keyboard's
 *    keyboardWillShow / keyboardWillHide and trust info.keyboardHeight.
 *    Requires plugins.Keyboard.resize = "none" in capacitor.config so
 *    the WebView is not resized for us — otherwise our JS-driven layout
 *    would double-count the keyboard. Configured in capacitor.config.ts
 *    and re-applied at runtime by KeyboardInit.
 *
 *    Earlier versions of this hook also merged the VisualViewport delta
 *    with Math.max() as a "defensive backup". That caused iOS to report
 *    a stale non-zero keyboardHeight on initial mount — innerHeight and
 *    visualViewport.height can momentarily disagree on WKWebView even
 *    with no keyboard open — which pushed the input bar 80-100pt above
 *    the home indicator on first paint. The native plugin is
 *    authoritative; trust it.
 *
 *  - Web: VisualViewport. keyboardHeight = innerHeight - vv.height,
 *    clamped to >= 0, rAF-coalesced. This is the only signal the web
 *    has for the on-screen keyboard.
 *
 * Both paths return 0 on desktop browsers (no on-screen keyboard).
 */
export function useKeyboardHeight(): number {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      try {
        const core = await import("@capacitor/core");
        if (cancelled) return;
        if (core.Capacitor.isNativePlatform()) {
          // Native path — plugin only, no VisualViewport.
          const { Keyboard } = await import("@capacitor/keyboard");
          if (cancelled) return;
          const showHandle = await Keyboard.addListener(
            "keyboardWillShow",
            (info) => {
              if (!cancelled) setKeyboardHeight(info.keyboardHeight);
            }
          );
          const hideHandle = await Keyboard.addListener(
            "keyboardWillHide",
            () => {
              if (!cancelled) setKeyboardHeight(0);
            }
          );
          if (cancelled) {
            showHandle.remove();
            hideHandle.remove();
            return;
          }
          cleanup = () => {
            showHandle.remove();
            hideHandle.remove();
          };
          return;
        }
      } catch {
        // @capacitor/core not present in this shell — fall through to web.
      }

      // Web path — VisualViewport only.
      const vv = window.visualViewport;
      if (!vv) return;
      let rafId: number | null = null;
      const apply = () => {
        rafId = null;
        if (!cancelled) {
          setKeyboardHeight(Math.max(0, window.innerHeight - vv.height));
        }
      };
      const schedule = () => {
        if (rafId !== null) return;
        rafId = requestAnimationFrame(apply);
      };
      schedule();
      vv.addEventListener("resize", schedule);
      vv.addEventListener("scroll", schedule);
      cleanup = () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        vv.removeEventListener("resize", schedule);
        vv.removeEventListener("scroll", schedule);
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return keyboardHeight;
}
