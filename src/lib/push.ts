// Server-side APNs push helper. Reads APNS_* env vars and is a no-op if any are
// missing — the rest of the app keeps working without push configured.
//
// Required env (see ONBOARDING / README):
//   APNS_KEY_PATH   — absolute path to your AuthKey_XXXXXXXX.p8 file
//   APNS_KEY_ID     — 10-char Key ID from the Apple Developer portal
//   APNS_TEAM_ID    — 10-char Team ID
//   APNS_BUNDLE_ID  — iOS app bundle id (must match capacitor.config.ts appId)
//   APNS_PRODUCTION — "true" once you've shipped to TestFlight/App Store; "false" or unset for the development APNs sandbox
//
// Token cleanup: APNs returns "Unregistered" / "BadDeviceToken" for stale tokens
// (uninstalled app, restored device). We delete those rows so we don't keep paying
// to deliver to dead devices.

import apn from "@parse/node-apn";
import { prisma } from "./prisma";

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

// Stash on globalThis so Fast Refresh in dev doesn't open a new HTTP/2 connection
// to APNs every time a route module reloads.
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
  // Custom data delivered alongside the alert. Used for deep-linking.
  data?: Record<string, string | number>;
  // Optional badge override. Bell unread count is the obvious choice if you want it.
  badge?: number;
  threadId?: string;
};

export async function pushToUser(userId: string, payload: PushPayload): Promise<void> {
  const cfg = readConfig();
  if (!cfg) return;
  const tokens = await prisma.deviceToken.findMany({
    where: { userId, platform: "ios" },
    select: { token: true },
  });
  if (tokens.length === 0) return;

  const note = new apn.Notification();
  note.alert = { title: payload.title, body: payload.body };
  note.sound = "default";
  note.topic = cfg.bundleId;
  if (typeof payload.badge === "number") note.badge = payload.badge;
  if (payload.threadId) note.threadId = payload.threadId;
  // Custom payload is attached at the top level by node-apn when set via .payload.
  note.payload = payload.data || {};

  const provider = getProvider(cfg);
  let result;
  try {
    result = await provider.send(note, tokens.map((t) => t.token));
  } catch (err) {
    console.error("[apns] send failed:", err);
    return;
  }

  // Reap tokens APNs has marked as dead.
  const deadTokens: string[] = [];
  for (const failure of result.failed) {
    const reason = failure.response?.reason ?? failure.error?.message ?? "";
    if (reason === "Unregistered" || reason === "BadDeviceToken") {
      deadTokens.push(failure.device);
    }
  }
  if (deadTokens.length) {
    await prisma.deviceToken.deleteMany({ where: { token: { in: deadTokens } } });
  }
}

export async function pushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  await Promise.all(userIds.map((id) => pushToUser(id, payload)));
}
