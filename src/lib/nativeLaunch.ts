"use client";

import { Capacitor } from "@capacitor/core";
import { useSyncExternalStore } from "react";

let finished = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function nativeLaunchPending() {
  return !finished && Capacitor.getPlatform() === "ios" &&
    window.location.pathname === "/" && !window.location.search && !window.location.hash;
}

export function finishNativeLaunch() {
  if (finished) return;
  finished = true;
  for (const listener of listeners) listener();
}

const showFeed = () => !nativeLaunchPending();

export function useNativeFeedReady() {
  // The server renders the Feed's usual auth skeleton. On iOS hydration the
  // launch check keeps the real Feed and its queries behind the same gate.
  return useSyncExternalStore(subscribe, showFeed, () => true);
}
