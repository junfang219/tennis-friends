"use client";

import { useEffect, useRef } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "./browser";
import type { Database } from "./types";

type PublicTable = keyof Database["public"]["Tables"];
type RowOf<T extends PublicTable> = Database["public"]["Tables"][T]["Row"];

type RealtimeEvent = "INSERT" | "UPDATE" | "DELETE" | "*";

interface SubscribeOptions<T extends PublicTable> {
  table: T;
  event?: RealtimeEvent;
  // Postgres filter expression, e.g. `chat_id=eq.${chatId}`. Supabase
  // evaluates this server-side using the same RLS policies as REST, so
  // there's no risk of leaking rows the user can't otherwise read.
  filter?: string;
  onChange: (payload: RealtimePostgresChangesPayload<RowOf<T>>) => void;
}

/**
 * Subscribe to Postgres CDC events on a single table. RLS applies — a user
 * only receives events for rows their policies permit. Returns a cleanup
 * function; React's useEffect should call it on unmount.
 *
 * Usage (inside a Client Component):
 *
 *   useEffect(() => subscribeToTable({
 *     table: "messages",
 *     filter: `receiver_id=eq.${me}`,
 *     onChange: (e) => {
 *       if (e.eventType === "INSERT") prepend(e.new);
 *     },
 *   }), [me]);
 */
export function subscribeToTable<T extends PublicTable>(
  opts: SubscribeOptions<T>
): () => void {
  const supabase = createSupabaseBrowserClient();
  const channelName = `tbl:${opts.table}:${opts.filter ?? "all"}`;
  const channel = supabase.channel(channelName).on(
    "postgres_changes",
    {
      event: opts.event ?? "*",
      schema: "public",
      table: opts.table,
      filter: opts.filter,
    },
    opts.onChange
  );
  channel.subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

/** React-hook wrapper that wires subscribeToTable into useEffect lifecycle. */
export function useRealtimeTable<T extends PublicTable>(
  opts: SubscribeOptions<T>,
  deps: ReadonlyArray<unknown>
): void {
  const handlerRef = useRef(opts.onChange);
  handlerRef.current = opts.onChange;

  useEffect(() => {
    const unsubscribe = subscribeToTable({
      table: opts.table,
      event: opts.event,
      filter: opts.filter,
      onChange: (payload) => handlerRef.current(payload),
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Presence channel — used for typing indicators, "active in chat" rosters,
 * etc. Each member identifies themselves with arbitrary metadata.
 *
 * Returns a cleanup function. Pass new presence state via the returned
 * `track` setter (e.g., when the user starts typing).
 */
export function joinPresenceChannel(
  channelName: string,
  initial: Record<string, unknown>,
  onSync: (state: Record<string, Record<string, unknown>[]>) => void
): { untrack: () => void; track: (state: Record<string, unknown>) => Promise<void> } {
  const supabase = createSupabaseBrowserClient();
  const channel = supabase.channel(channelName, {
    config: { presence: { key: channelName } },
  });
  channel
    .on("presence", { event: "sync" }, () => {
      onSync(channel.presenceState() as Record<string, Record<string, unknown>[]>);
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track(initial);
      }
    });

  return {
    untrack: () => {
      supabase.removeChannel(channel);
    },
    track: async (state) => {
      await channel.track(state);
    },
  };
}
