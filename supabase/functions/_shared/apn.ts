// Minimal APN HTTP/2 client for Deno Edge Functions.
//
// Replaces the Node-only @parse/node-apn helper at src/lib/push.ts so
// pushes can be sent from Supabase Edge Functions (push-fanout +
// event-reminders). Uses Web Crypto for the ES256 JWT, the global
// fetch() for HTTP/2 (Deno's fetch is HTTP/2-by-default — APNs requires
// it), and a 50-min JWT cache to stay within Apple's 60-min cap.
//
// Configuration is read from env vars and the function no-ops with a
// log warning if any are missing — matching the legacy push.ts so the
// project keeps working before APNs is provisioned.
//
// Env vars (configure as function secrets):
//   APNS_KEY_PEM       Full contents of AuthKey_XXXXXXXX.p8 (BEGIN/END headers included).
//   APNS_KEY_ID        10-char Key ID from developer.apple.com.
//   APNS_TEAM_ID       10-char Team ID.
//   APNS_BUNDLE_ID     e.g. com.tennisfriend.app.
//   APNS_PRODUCTION    "true" once shipping via TestFlight / App Store; else sandbox.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

type ApnConfig = {
  keyPem: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  production: boolean;
};

export type ApnPayload = {
  title: string;
  body: string;
  data?: Record<string, string | number | boolean>;
  badge?: number;
  threadId?: string;
};

export function readApnConfig(): ApnConfig | null {
  const keyPem = Deno.env.get("APNS_KEY_PEM");
  const keyId = Deno.env.get("APNS_KEY_ID");
  const teamId = Deno.env.get("APNS_TEAM_ID");
  const bundleId = Deno.env.get("APNS_BUNDLE_ID");
  if (!keyPem || !keyId || !teamId || !bundleId) return null;
  return {
    keyPem,
    keyId,
    teamId,
    bundleId,
    production: Deno.env.get("APNS_PRODUCTION") === "true",
  };
}

// ---------------------------------------------------------------------
// JWT signing (ES256). Cached for 50 min — Apple's hard cap is 60 min;
// reusing a JWT also avoids `TooManyProviderTokenUpdates` throttling.
// ---------------------------------------------------------------------

const JWT_TTL_MS = 50 * 60 * 1000;
let cachedJwt: { token: string; expiresAt: number; teamId: string; keyId: string } | null =
  null;

function b64UrlEncode(input: Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else {
    bytes = input;
  }
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importEs256Key(pem: string): Promise<CryptoKey> {
  const der = pemToDer(pem);
  return await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}

export async function getApnJwt(cfg: ApnConfig): Promise<string> {
  const now = Date.now();
  if (
    cachedJwt &&
    cachedJwt.expiresAt > now &&
    cachedJwt.teamId === cfg.teamId &&
    cachedJwt.keyId === cfg.keyId
  ) {
    return cachedJwt.token;
  }

  const header = { alg: "ES256", kid: cfg.keyId, typ: "JWT" };
  const claims = { iss: cfg.teamId, iat: Math.floor(now / 1000) };
  const signingInput =
    b64UrlEncode(JSON.stringify(header)) + "." + b64UrlEncode(JSON.stringify(claims));

  const key = await importEs256Key(cfg.keyPem);
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput)
  );
  const jwt = signingInput + "." + b64UrlEncode(new Uint8Array(sig));
  cachedJwt = {
    token: jwt,
    expiresAt: now + JWT_TTL_MS,
    teamId: cfg.teamId,
    keyId: cfg.keyId,
  };
  return jwt;
}

// ---------------------------------------------------------------------
// HTTP/2 POST to APNs. Deno's fetch is HTTP/2-by-default for HTTPS
// origins that ALPN-negotiate it — api.push.apple.com does.
// ---------------------------------------------------------------------

type ApnSendResult = {
  token: string;
  ok: boolean;
  status: number;
  reason?: string;
};

async function sendOne(
  cfg: ApnConfig,
  jwt: string,
  token: string,
  payload: ApnPayload
): Promise<ApnSendResult> {
  const host = cfg.production ? "api.push.apple.com" : "api.sandbox.push.apple.com";
  const aps: Record<string, unknown> = {
    alert: { title: payload.title, body: payload.body },
    sound: "default",
  };
  if (typeof payload.badge === "number") aps.badge = payload.badge;
  if (payload.threadId) aps["thread-id"] = payload.threadId;

  const body: Record<string, unknown> = { aps, ...(payload.data ?? {}) };

  try {
    const resp = await fetch(`https://${host}/3/device/${token}`, {
      method: "POST",
      headers: {
        "authorization": `bearer ${jwt}`,
        "apns-topic": cfg.bundleId,
        "apns-push-type": "alert",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (resp.ok) {
      // Drain body so the underlying connection can be reused.
      await resp.body?.cancel();
      return { token, ok: true, status: resp.status };
    }
    let reason: string | undefined;
    try {
      const text = await resp.text();
      const j = JSON.parse(text);
      reason = typeof j?.reason === "string" ? j.reason : undefined;
    } catch { /* response wasn't JSON */ }
    return { token, ok: false, status: resp.status, reason };
  } catch (err) {
    console.error("[apn] fetch threw:", err);
    return { token, ok: false, status: 0, reason: "fetch_error" };
  }
}

// ---------------------------------------------------------------------
// Public entry: send to every device_token row owned by a user.
// Dead tokens (410 Unregistered / BadDeviceToken) are deleted so we
// don't keep paying to deliver to uninstalled apps.
// ---------------------------------------------------------------------

export async function pushToUsers(
  supabase: SupabaseClient,
  userIds: string[],
  payload: ApnPayload
): Promise<{ sent: number; dead: number; missing: number }> {
  const cfg = readApnConfig();
  if (!cfg) {
    console.warn("[apn] APNS_* secrets missing — skipping send");
    return { sent: 0, dead: 0, missing: 0 };
  }
  if (userIds.length === 0) return { sent: 0, dead: 0, missing: 0 };

  const { data: rows, error } = await supabase
    .from("device_tokens")
    .select("token, user_id")
    .in("user_id", userIds)
    .eq("platform", "ios");
  if (error) {
    console.error("[apn] device_tokens lookup failed:", error.message);
    return { sent: 0, dead: 0, missing: 0 };
  }
  const tokens = (rows ?? []) as { token: string; user_id: string }[];
  if (tokens.length === 0) return { sent: 0, dead: 0, missing: userIds.length };

  const jwt = await getApnJwt(cfg);
  const results = await Promise.all(
    tokens.map((t) => sendOne(cfg, jwt, t.token, payload))
  );

  const dead = results
    .filter((r) => !r.ok && (r.reason === "Unregistered" || r.reason === "BadDeviceToken"))
    .map((r) => r.token);
  if (dead.length > 0) {
    await supabase.from("device_tokens").delete().in("token", dead);
  }

  const sent = results.filter((r) => r.ok).length;
  return { sent, dead: dead.length, missing: 0 };
}

export function getSupabaseAdmin(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
