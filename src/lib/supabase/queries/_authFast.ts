"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";
import { getCachedUserId } from "../auth-store";

// Fast user-id accessor for chat-mount queries.
//
// Plain `supabase.auth.getUser()` hits /auth/v1/user every call (~60-90ms
// each). When a chat opens we need the viewer's id to scope the messages
// query AND the markRead upsert, so two helpers used to issue two
// sequential auth round trips just to discover an id we already have in
// memory via the auth-store snapshot.
//
// Priority:
//   1. auth-store snapshot — populated on first page mount, kept live by
//      onAuthStateChange. Sync, zero RTT.
//   2. supabase.auth.getSession() — local-storage backed cookie/session
//      read inside @supabase/ssr. Still no network in the common case.
//   3. null — caller decides whether to fall back further or error.
//
// Server-side RLS is the source of truth for authorization, so reading
// the id from a cached snapshot here doesn't widen any trust boundary.
export async function getMyIdFast(
  supabase: SupabaseClient<Database>
): Promise<string | null> {
  const cached = getCachedUserId();
  if (cached) return cached;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}
