"use client";

// Module-level cache for the current Supabase auth user, shared across every
// useSession() / useSupabaseUser() call in the React tree.
//
// Without this, each consumer mounts with its own loading=true state and
// briefly renders as if no user is signed in — even when a parent already
// resolved the session. That caused visible flickers like the feed showing
// "Mimi Fang's Game confirmed" for a frame before flipping to "Your Game
// confirmed" once each PostCard's own useSession() call resolved.
//
// We fire the initial getUser() exactly once per browser session, then keep
// the cache live via onAuthStateChange. Hooks subscribe to changes and
// re-render via useSyncExternalStore so SSR and concurrent rendering see a
// stable snapshot.

import { useSyncExternalStore } from "react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "./browser";

type Snapshot = {
  user: User | null;
  loaded: boolean;
};

let snapshot: Snapshot = { user: null, loaded: false };
const listeners = new Set<() => void>();
let started = false;

// --- Temporary auth-logout diagnostics (see auth_debug_events migration) ---
// Records every auth state transition to a write-only Postgres table so we can
// catch *unexpected* SIGNED_OUT events (the "users randomly logged out" bug)
// with context the 24h GoTrue logs don't retain. Best-effort and removable.
let detectedPlatform = "unknown";
let pendingUserInitiatedSignOut = false;

/** Called by our signOut() wrapper so the next SIGNED_OUT is tagged expected. */
export function markUserInitiatedSignOut(): void {
  pendingUserInitiatedSignOut = true;
}

async function detectPlatform(): Promise<void> {
  try {
    const core = await import("@capacitor/core");
    detectedPlatform = core.Capacitor.getPlatform(); // "ios" | "android" | "web"
  } catch {
    detectedPlatform = "web";
  }
}

function recordAuthEvent(
  supabase: SupabaseClient,
  event: string,
  session: Session | null,
  priorUserId: string | null
): void {
  const userInitiated = event === "SIGNED_OUT" && pendingUserInitiatedSignOut;
  if (event === "SIGNED_OUT") pendingUserInitiatedSignOut = false;
  try {
    void supabase
      .from("auth_debug_events")
      .insert({
        event,
        prior_user_id: priorUserId,
        has_session: !!session,
        user_initiated: userInitiated,
        platform: detectedPlatform,
        details: {
          path: window.location?.pathname ?? null,
          visibility:
            typeof document !== "undefined" ? document.visibilityState : null,
        },
      })
      .then(() => {}, () => {}); // swallow — diagnostics must never surface errors
  } catch {
    // best-effort
  }
}

function setSnapshot(next: Snapshot) {
  snapshot = next;
  for (const fn of listeners) fn();
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  void detectPlatform();
  const supabase = createSupabaseBrowserClient();
  supabase.auth.getUser().then(({ data }) => {
    setSnapshot({ user: data.user ?? null, loaded: true });
  });
  supabase.auth.onAuthStateChange((event, session) => {
    const priorUserId = snapshot.user?.id ?? null;
    setSnapshot({ user: session?.user ?? null, loaded: true });
    recordAuthEvent(supabase, event, session, priorUserId);
  });
}

function subscribe(cb: () => void) {
  start();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Snapshot {
  return snapshot;
}

// Server snapshot — useSyncExternalStore requires a stable value during SSR.
const SERVER_SNAPSHOT: Snapshot = { user: null, loaded: false };
function getServerSnapshot(): Snapshot {
  return SERVER_SNAPSHOT;
}

export function useAuthSnapshot(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export async function refreshAuthSnapshot(): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { data } = await supabase.auth.getUser();
  setSnapshot({ user: data.user ?? null, loaded: true });
}

// Non-hook synchronous accessor for query helpers that run outside a
// React render. Reads from the same in-memory snapshot the hooks read,
// so query helpers can build RLS-aware filters without a /auth/v1/user
// round trip every time. Returns null before the initial getUser()
// resolves; callers should fall back to a network read in that window.
export function getCachedUserId(): string | null {
  return snapshot.user?.id ?? null;
}
