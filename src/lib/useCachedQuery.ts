"use client";

// Stale-while-revalidate hook over the shared queryCache.
//
// First mount with no cached value:  isLoading=true, fetcher runs, data
//                                    populates, isLoading flips to false.
// Subsequent mounts (cached value):  isLoading=false from the first render,
//                                    fetcher still runs in the background and
//                                    overwrites the cached value when it
//                                    resolves. Subscribers re-render via
//                                    useSyncExternalStore.
//
// Pass `key = null` to opt out (e.g. when the user isn't authenticated yet).
// While key is null, data is undefined and no fetcher runs.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { getCached, setCached, subscribeCached } from "./queryCache";

interface UseCachedQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
  /** Re-run the fetcher and overwrite the cache. */
  refetch: () => Promise<void>;
  /**
   * Synchronously update the cached value. Accepts a new value or an updater
   * function. Use this for optimistic mutations — the cache is the source of
   * truth and every subscriber re-renders.
   */
  mutate: (next: T | ((prev: T | undefined) => T)) => void;
}

const noopSubscribe = () => () => {};

export function useCachedQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
): UseCachedQueryResult<T> {
  const data = useSyncExternalStore<T | undefined>(
    key ? (cb) => subscribeCached(key, cb) : noopSubscribe,
    () => (key ? getCached<T>(key) : undefined),
    () => undefined,
  );

  const [error, setError] = useState<Error | null>(null);
  // Keep the fetcher in a ref so changing its identity between renders
  // doesn't re-trigger the network effect. Callers usually inline a closure
  // (`() => listFeed(supabase, ...)`) so this is the safer default.
  // Sync via useLayoutEffect so the ref is up-to-date before any useEffect
  // that reads it fires.
  const fetcherRef = useRef(fetcher);
  useLayoutEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    fetcherRef.current()
      .then((result) => {
        if (cancelled) return;
        setCached(key, result);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const refetch = useCallback(async () => {
    if (!key) return;
    try {
      const result = await fetcherRef.current();
      setCached(key, result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [key]);

  const mutate = useCallback(
    (next: T | ((prev: T | undefined) => T)) => {
      if (!key) return;
      const current = getCached<T>(key);
      const value =
        typeof next === "function"
          ? (next as (prev: T | undefined) => T)(current)
          : next;
      setCached(key, value);
    },
    [key],
  );

  // While key is null we have no real "loading" — caller deliberately opted
  // out. While key is set and we have no data yet and no error, we're loading.
  const isLoading = key != null && data === undefined && error === null;

  return { data, isLoading, error, refetch, mutate };
}
