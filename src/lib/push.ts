import "server-only";
import apn from "@parse/node-apn";
import { createSupabaseAdminClient } from "./supabase/admin";

// Server-side APNs push helper. Reads APNS_* env vars and is a no-op if any
// are missing — the rest of the app keeps working without push configured.
// See PUSH_SETUP.md for the Apple Developer dance + env var values.
//
// Token cleanup: APNs returns "Unregistered" / "BadDeviceToken" for stale
// tokens (uninstalled app, restored device). We delete those rows so we
// don't keep paying to deliver to dead devices.

type Cfg = {
  keyPath: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  production: boolean;
};

function readConfig(): Cfg | null {
  const keyPath = process.env.APNS_KEY_PATH;
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const bundleId = process.env.APNS_BUNDLE_ID;
  if (!keyPath || !keyId || !teamId || !bundleId) return null;
  return {
    keyPath,
    keyId,
    teamId,
    bundleId,
    production: process.env.APNS_PRODUCTION === "true",
  };
}

// Stash the provider on globalThis so Fast Refresh in dev doesn't open a new
// HTTP/2 connection to APNs every time a route module reloads.
const g = globalThis as unknown as { __apnsProvider?: apn.Provider | null };

function getProvider(cfg: Cfg): apn.Provider {
  if (g.__apnsProvider) return g.__apnsProvider;
  const provider = new apn.Provider({
    token: { key: cfg.keyPath, keyId: cfg.keyId, teamId: cfg.teamId },
    production: cfg.production,
  });
  g.__apnsProvider = provider;
  return provider;
}

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, string | number>;
  badge?: number;
  threadId?: string;
};

export async function pushToUser(userId: string, payload: PushPayload): Promise<void> {
  const cfg = readConfig();
  if (!cfg) return;

  const admin = createSupabaseAdminClient();
  const { data: tokens } = await admin
    .from("device_tokens")
    .select("token")
    .eq("user_id", userId)
    .eq("platform", "ios");
  if (!tokens || tokens.length === 0) return;

  const note = new apn.Notification();
  note.alert = { title: payload.title, body: payload.body };
  note.sound = "default";
  note.topic = cfg.bundleId;
  if (typeof payload.badge === "number") note.badge = payload.badge;
  if (payload.threadId) note.threadId = payload.threadId;
  note.payload = payload.data || {};

  const provider = getProvider(cfg);
  let result;
  try {
    result = await provider.send(note, tokens.map((t) => t.token));
  } catch (err) {
    console.error("[apns] send failed:", err);
    return;
  }

  const deadTokens: string[] = [];
  for (const failure of result.failed) {
    const reason = failure.response?.reason ?? failure.error?.message ?? "";
    if (reason === "Unregistered" || reason === "BadDeviceToken") {
      deadTokens.push(failure.device);
    }
  }
  if (deadTokens.length) {
    await admin.from("device_tokens").delete().in("token", deadTokens);
  }
}

export async function pushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  await Promise.all(userIds.map((id) => pushToUser(id, payload)));
}
