"use client";

import { useEffect } from "react";

// One-shot iOS keyboard configuration, run once at app mount.
//
// 1. Hide the form-accessory bar (^/v jump-to-field + Done above the
//    keyboard) — has no use here and reads as a stray tick bar.
//
// 2. Force KeyboardResize.None at runtime. This matches what's in
//    capacitor.config.ts but takes effect immediately even if the user
//    hasn't re-run `npx cap sync`. It tells iOS NOT to resize the
//    WebView when the keyboard opens — we want the WebView at its full
//    viewport height so our JS-driven layout (chat surface fixed
//    inset-0 + input bar bottom = keyboardHeight + safe-area) is the
//    single source of truth. With the default Native resize mode,
//    window.innerHeight and visualViewport.height shrink in lockstep,
//    breaking the VisualViewport-delta keyboard-height calculation
//    used by the web fallback in useKeyboardHeight.
//
// Web no-op — Capacitor is only present in the native shell.

export default function KeyboardInit() {
  useEffect(() => {
    (async () => {
      try {
        const core = await import("@capacitor/core");
        if (!core.Capacitor.isNativePlatform()) return;
        if (core.Capacitor.getPlatform() !== "ios") return;
        const { Keyboard, KeyboardResize } = await import("@capacitor/keyboard");
        await Keyboard.setAccessoryBarVisible({ isVisible: false });
        await Keyboard.setResizeMode({ mode: KeyboardResize.None });
      } catch {
        // Plugin not installed in the running shell — silently no-op.
        // Next `npx cap sync` picks it up.
      }
    })();
  }, []);

  return null;
}
