"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Capacitor Universal Link handler.
//
// When iOS opens the app via a https://mytennisfriends.com/... universal link
// (the Associated Domains entitlement + apple-app-site-association declare
// which paths qualify), Capacitor delivers the URL via the `appUrlOpen`
// event. Without a listener the app just opens to the previous screen and
// the link is dropped — the WebView never navigates to the target path.
//
// Mounted once at the layout root; web is a clean no-op (the dynamic import
// of @capacitor/app resolves to a stub when Capacitor.isNativePlatform()
// returns false, but we still gate the listener registration so we don't
// burn a useEffect cycle in the browser bundle).

export default function AppUrlOpenListener() {
  const router = useRouter();

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        const core = await import("@capacitor/core");
        if (!core.Capacitor.isNativePlatform()) return;

        const { App } = await import("@capacitor/app");
        // addListener resolves to a PluginListenerHandle; we await it so we
        // can call .remove() in cleanup. On hot reload during dev this
        // prevents stacking duplicate listeners that each re-route the URL.
        const handle = await App.addListener("appUrlOpen", (event) => {
          if (!event?.url) return;
          try {
            const url = new URL(event.url);
            // Only act on our own domain to avoid hijacking unrelated URL
            // schemes (e.g. OAuth callbacks already handled elsewhere).
            if (url.hostname !== "mytennisfriends.com") return;
            const target = `${url.pathname}${url.search}${url.hash}`;
            if (!target.startsWith("/")) return;
            router.push(target);
          } catch {
            // Malformed URL — ignore.
          }
        });
        if (cancelled) {
          // Component unmounted before listener finished registering.
          handle.remove();
          return;
        }
        unsubscribe = () => handle.remove();
      } catch {
        // Capacitor not available — web environment.
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [router]);

  return null;
}
