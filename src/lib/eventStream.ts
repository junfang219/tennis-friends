"use client";

// Shared singleton EventSource subscription. Both NotificationBell and MessageBell
// (and future consumers) call onAppEvent(...). One HTTP connection per signed-in tab.

export type AppEvent = { kind: string; [k: string]: unknown };
type Handler = (event: AppEvent) => void;

let source: EventSource | null = null;
const handlers = new Set<Handler>();

function ensureSource(): EventSource | null {
  if (typeof window === "undefined") return null;
  if (source) return source;
  source = new EventSource("/api/notifications/stream");
  source.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data) as AppEvent;
      handlers.forEach((h) => h(data));
    } catch {
      // Ignore malformed payloads; stream pings are SSE comments and never reach here.
    }
  };
  source.onerror = () => {
    // Browser will auto-reconnect after a short backoff. Nothing to do here.
    // The bells keep a low-frequency safety poll as a backstop.
  };
  return source;
}

export function onAppEvent(handler: Handler): () => void {
  ensureSource();
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0 && source) {
      source.close();
      source = null;
    }
  };
}
