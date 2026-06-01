"use client";

import { useSyncExternalStore } from "react";
import {
  detectEmbeddedBrowser,
  type EmbeddedBrowserInfo,
} from "@/lib/auth/embeddedBrowser";

// The UA doesn't change within a session — there's nothing to subscribe to.
function subscribe(): () => void {
  return () => {};
}

function getSnapshot(): EmbeddedBrowserInfo | null {
  return detectEmbeddedBrowser(navigator.userAgent);
}

// Server can't know the UA-sniffed value. Render null and let the client
// snapshot correct it on hydration.
function getServerSnapshot(): EmbeddedBrowserInfo | null {
  return null;
}

/**
 * Returns info about the embedded in-app browser the page is loaded in
 * (e.g. Instagram, Facebook), or null in a real browser. Used to warn
 * the user before they hit Google's `disallowed_useragent` 403.
 */
export function useIsEmbeddedBrowser(): EmbeddedBrowserInfo | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
