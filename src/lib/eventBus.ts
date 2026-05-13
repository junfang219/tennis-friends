import { EventEmitter } from "events";

export type AppEvent =
  | { kind: "hello" }
  | { kind: "notifications" }
  | { kind: "inbox" }
  | { kind: "messages"; with: string }; // optional hint for an open thread

// Single-process in-memory bus. Survives Fast Refresh by stashing on globalThis.
// In a scaled/serverless prod deployment swap this for Redis pub/sub or similar.
type Bus = EventEmitter;
const g = globalThis as unknown as { __appEventBus?: Bus };
const emitter: Bus = g.__appEventBus ?? new EventEmitter();
emitter.setMaxListeners(0);
g.__appEventBus = emitter;

const channelFor = (userId: string) => `u:${userId}`;

export function subscribe(userId: string, handler: (e: AppEvent) => void): () => void {
  const channel = channelFor(userId);
  emitter.on(channel, handler);
  return () => {
    emitter.off(channel, handler);
  };
}

export function emitToUser(userId: string, event: AppEvent): void {
  emitter.emit(channelFor(userId), event);
}

export function emitToUsers(userIds: string[], event: AppEvent): void {
  for (const id of userIds) emitter.emit(channelFor(id), event);
}
