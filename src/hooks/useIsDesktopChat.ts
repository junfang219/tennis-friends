"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(min-width: 768px)";

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

function subscribe(onStoreChange: () => void): () => void {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onStoreChange);
  return () => mql.removeEventListener("change", onStoreChange);
}

function getServerSnapshot(): boolean {
  return false;
}

export function useIsDesktopChat(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
