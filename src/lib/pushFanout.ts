import "server-only";

// Thin HTTPS shim that posts to the push-fanout edge function so the
// cron (and any future Node caller) doesn't need its own APN client.
// All APN delivery flows through supabase/functions/push-fanout, which
// signs ES256 JWTs from Web Crypto. The shared trigger secret lives in
// Supabase Vault and is mirrored to:
//   - EDGE_FUNCTION_TRIGGER_SECRET (this process)
//   - TRIGGER_SECRET (push-fanout + group-invite-email env vars)
// All three must match or push-fanout returns 401 / 503.

export type FanoutPayload = {
  title: string;
  body: string;
  data?: Record<string, string | number | boolean>;
  threadId?: string;
  badge?: number;
};

export type FanoutResult = { ok: boolean; status: number; error?: string };

export async function postPushFanout(
  userIds: string[],
  payload: FanoutPayload
): Promise<FanoutResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.EDGE_FUNCTION_TRIGGER_SECRET;
  const authKey =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !secret || !authKey) {
    // Match the old pushToUsers() behaviour: silently no-op when push
    // isn't configured. The caller decides what counts as "delivered"
    // (currently: anything that isn't a hard 5xx).
    return { ok: false, status: 0, error: "push not configured" };
  }
  if (userIds.length === 0) return { ok: true, status: 204 };

  const body = JSON.stringify({
    user_ids: userIds,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    thread_id: payload.threadId,
    badge: payload.badge,
  });

  let res: Response;
  try {
    res = await fetch(`${url}/functions/v1/push-fanout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authKey}`,
        "Content-Type": "application/json",
        "X-Trigger-Secret": secret,
      },
      body,
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : "fetch failed",
    };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: detail || res.statusText };
  }
  return { ok: true, status: res.status };
}
