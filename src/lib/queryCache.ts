// In-memory query cache shared by useCachedQuery.
//
// Stale-while-revalidate: callers read whatever's in the cache synchronously,
// while their fetcher runs in the background and writes a fresh value via
// setCached(). Subscribers (the hook) re-render on every write.
//
// Pure module: no React, no Supabase, no DOM. Tested in isolation.

type Listener = () => void;

const cache = new Map<string, unknown>();
const listeners = new Map<string, Set<Listener>>();

export function getCached<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}

export function setCached<T>(key: string, value: T): void {
  cache.set(key, value);
  const set = listeners.get(key);
  if (set) for (const l of set) l();
}

export function subscribeCached(key: string, listener: Listener): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    const s = listeners.get(key);
    if (!s) return;
    s.delete(listener);
    if (s.size === 0) listeners.delete(key);
  };
}

// Wipe everything — used on sign-out so the next user doesn't inherit the
// previous account's cached data.
export function clearAllCached(): void {
  const keys = [...cache.keys()];
  cache.clear();
  for (const key of keys) {
    const set = listeners.get(key);
    if (set) for (const l of set) l();
  }
}

// Test-only escape hatch. Not exported through any index.
export function __resetForTests(): void {
  cache.clear();
  listeners.clear();
}
