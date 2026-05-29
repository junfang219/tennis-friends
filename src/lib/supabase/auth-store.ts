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
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "./browser";

type Snapshot = {
  user: User | null;
  loaded: boolean;
};

let snapshot: Snapshot = { user: null, loaded: false };
const listeners = new Set<() => void>();
let started = false;

function setSnapshot(next: Snapshot) {
  snapshot = next;
  for (const fn of listeners) fn();
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const supabase = createSupabaseBrowserClient();
  supabase.auth.getUser().then(({ data }) => {
    setSnapshot({ user: data.user ?? null, loaded: true });
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    setSnapshot({ user: session?.user ?? null, loaded: true });
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
