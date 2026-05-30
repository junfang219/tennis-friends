"use client";

import { useSyncExternalStore } from "react";

// `window.Capacitor` exists in the web bundle too (the @capacitor/core stub
// assigns itself on import), so `isNativePlatform()` is the only reliable way
// to tell the iOS/Android shell apart from the browser — the same check
// Navbar/BottomNav use.
function getSnapshot(): boolean {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

// Native-ness never changes within a session, so there's nothing to subscribe
// to — a no-op unsubscribe satisfies the store contract.
function subscribe(): () => void {
  return () => {};
}

// The server can't know the platform; render false there and let the client
// snapshot correct it on hydration (no mismatch, since the server snapshot is
// what SSR uses).
function getServerSnapshot(): boolean {
  return false;
}

/** True only inside the Capacitor iOS/Android shell, false on the web. */
export function useIsNative(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
