"use client";

import { useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

// Drives Supabase's token auto-refresh off Capacitor's app-state events on
// native.
//
// Why this is needed: supabase-js runs an interval timer to refresh the access
// token before it expires. On iOS the JS timer is suspended while the app is
// backgrounded, and `visibilitychange` (which supabase-js otherwise leans on)
// is not a reliable foreground signal inside WKWebView. So after a long
// background the timer can wake up and refresh using a refresh token that the
// server-side middleware already rotated — Supabase's refresh-token-reuse
// detection then revokes the whole session and the user is logged out.
//
// Following Supabase's documented mobile pattern, we stop the refresh ticker on
// background and restart it on foreground. Combined with the singleton browser
// client (one refresh authority on the client — see lib/supabase/browser.ts),
// this keeps refreshes serialized and prevents stale-token reuse.
//
// Web is a clean no-op: the dynamic import is gated on isNativePlatform(), and
// in the browser supabase-js already manages its own refresh lifecycle.
export default function AuthRefreshController() {
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        const core = await import("@capacitor/core");
        if (!core.Capacitor.isNativePlatform()) return;

        const { App } = await import("@capacitor/app");
        const supabase = createSupabaseBrowserClient();

        const handle = await App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) {
            // Foreground: resume the ticker. supabase-js refreshes once if the
            // token is near/past expiry, serialized by its lock — and reads the
            // latest cookie state (which middleware may have rotated server-side
            // while we were backgrounded) rather than blindly reusing the old
            // refresh token.
            void supabase.auth.startAutoRefresh();
          } else {
            // Background: stop the ticker so it can't fire on a stale token.
            void supabase.auth.stopAutoRefresh();
          }
        });

        if (cancelled) {
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
  }, []);

  return null;
}
