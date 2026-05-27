// Supabase Edge Function: push-fanout
//
// Generic APN push entry point invoked by database triggers via
// public.invoke_edge_function(). Restores the per-action APN delivery
// that /api/messages, /api/chats/[id]/messages, /api/groups/[id]/messages
// and /api/messages/reactions all did before the burn-down (86f26a5).
//
// Request body (JSON, posted by DB triggers):
//   {
//     "user_ids":   ["uuid", ...],   // recipients
//     "title":      "Alice",          // banner title
//     "body":       "hey there",      // banner body
//     "data":       { ... },          // optional custom keys → APN payload
//     "thread_id":  "chat-123",       // optional iOS notification grouping
//     "badge":      5                 // optional badge count
//   }
//
// Returns { sent, dead, missing } counts. Errors are logged but never
// raised — push is best-effort.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { pushToUsers, getSupabaseAdmin, type ApnPayload } from "../_shared/apn.ts";

interface FanoutPayload {
  user_ids?: string[];
  title?: string;
  body?: string;
  data?: Record<string, string | number | boolean>;
  thread_id?: string;
  badge?: number;
}

Deno.serve(async (req: Request) => {
  let payload: FanoutPayload;
  try {
    payload = (await req.json()) as FanoutPayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const userIds = Array.isArray(payload.user_ids)
    ? payload.user_ids.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  const title = (payload.title ?? "").trim();
  const body = (payload.body ?? "").trim();

  if (userIds.length === 0 || (!title && !body)) {
    return Response.json(
      { ok: false, error: "user_ids and at least one of title/body required" },
      { status: 400 }
    );
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (err) {
    console.error("[push-fanout]", err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }

  const apnPayload: ApnPayload = {
    title,
    body,
    data: payload.data ?? {},
    threadId: payload.thread_id,
    badge: typeof payload.badge === "number" ? payload.badge : undefined,
  };

  const result = await pushToUsers(admin, userIds, apnPayload);
  return Response.json({ ok: true, ...result });
});
