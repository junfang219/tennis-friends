// In-memory query cache shared by useCachedQuery.
//
// Stale-while-revalidate: callers read whatever's in the cache synchronously,
// while their fetcher runs in the background and writes a fresh value via
// setCached(). Subscribers (the hook) re-render on every write.
//
// Optional persistence: pass `persist = true` to getCached/setCached and the
// value is mirrored to localStorage under the "qc:" prefix. This survives a
// full app relaunch (e.g. every Capacitor/iOS cold start), so a persisted key
// paints its last-known value on the very first render instead of flashing
// empty while the network round-trips run. The in-memory Map stays the source
// of truth within a session; localStorage is only read once, to seed it.
//
// Pure-ish module: no React, no Supabase. localStorage access is guarded so it
// no-ops under SSR / the node test environment.

type Listener = () => void;

const cache = new Map<string, unknown>();
const listeners = new Map<string, Set<Listener>>();

const LS_PREFIX = "qc:";

function readPersisted<T>(key: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(LS_PREFIX + key);
    return raw == null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

function writePersisted<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota exceeded / disabled storage — fall back to memory-only silently.
  }
}

function clearPersisted(): void {
  if (typeof window === "undefined") return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) toRemove.push(k);
    }
    for (const k of toRemove) window.localStorage.removeItem(k);
  } catch {
    // ignore
  }
}

export function getCached<T>(key: string, persist = false): T | undefined {
  // Seed the Map from localStorage the first time a persisted key is read.
  // Seeding once (rather than parsing on every call) keeps the returned
  // reference stable, which useSyncExternalStore's getSnapshot requires.
  if (persist && !cache.has(key)) {
    const stored = readPersisted<T>(key);
    if (stored !== undefined) cache.set(key, stored);
  }
  return cache.get(key) as T | undefined;
}

export function setCached<T>(key: string, value: T, persist = false): void {
  cache.set(key, value);
  if (persist) writePersisted(key, value);
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
// previous account's cached data. Also clears persisted localStorage entries.
export function clearAllCached(): void {
  const keys = [...cache.keys()];
  cache.clear();
  clearPersisted();
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
