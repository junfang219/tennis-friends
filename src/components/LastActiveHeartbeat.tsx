"use client";

import { useEffect } from "react";
import { useSession } from "@/lib/supabase/nextauth-compat";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { touchLastActive } from "@/lib/supabase/queries";

// Don't write more than once per this window. A presence signal doesn't need
// minute precision, and throttling keeps us to roughly one write per app
// session rather than one per navigation/tab-focus.
const HEARTBEAT_THROTTLE_MS = 5 * 60 * 1000;
// Persist the last write time across reloads so a quick refresh loop doesn't
// hammer the row.
const STORAGE_KEY = "tf:last-active-heartbeat";

function lastSentAt(): number {
  try {
    return Number(localStorage.getItem(STORAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * Invisible component that stamps the signed-in user's last_active while they
 * use the app — on load and whenever the tab becomes visible again, throttled.
 * Powers the Discover "recently active" sort. Mounted once in the root layout.
 */
export default function LastActiveHeartbeat() {
  const { status } = useSession();

  useEffect(() => {
    if (status !== "authenticated") return;

    const beat = () => {
      if (Date.now() - lastSentAt() < HEARTBEAT_THROTTLE_MS) return;
      // Stamp optimistically so concurrent visibility/mount calls don't both
      // fire before the write resolves.
      try {
        localStorage.setItem(STORAGE_KEY, String(Date.now()));
      } catch {
        /* storage unavailable — still attempt the write below */
      }
      const supabase = createSupabaseBrowserClient();
      void touchLastActive(supabase).catch(() => {
        /* best-effort presence; ignore failures */
      });
    };

    beat();

    const onVisible = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [status]);

  return null;
}
