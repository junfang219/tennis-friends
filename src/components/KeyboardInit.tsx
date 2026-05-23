"use client";

import { useEffect } from "react";

// Hides the iOS form-accessory bar (the ^/v jump-to-field arrows + Done
// button that appears above the keyboard when any input is focused). It
// has no use in a chat surface and the gap it adds between the keyboard
// and the input is what looks like an unexplained "tick" bar on iOS.
// Web no-op — Capacitor is only present in the native shell.

export default function KeyboardInit() {
  useEffect(() => {
    (async () => {
      try {
        const core = await import("@capacitor/core");
        if (!core.Capacitor.isNativePlatform()) return;
        if (core.Capacitor.getPlatform() !== "ios") return;
        const { Keyboard } = await import("@capacitor/keyboard");
        await Keyboard.setAccessoryBarVisible({ isVisible: false });
      } catch {
        // Plugin not installed in the running shell — silently no-op.
        // Next `npx cap sync` picks it up.
      }
    })();
  }, []);

  return null;
}
