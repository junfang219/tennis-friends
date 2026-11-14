import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { calendarLinkRequestSchema } from "./calendarLinks";

export const CALENDAR_LINK_MAX_BYTES = 4096;
export const CALENDAR_LINK_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const snapshotSchema = calendarLinkRequestSchema.omit({ guestToken: true }).extend({
  issuedAt: z.number().int().nonnegative(), expiresAt: z.number().int().positive(),
});
const secretSchema = z.string().regex(/^[a-fA-F0-9]{64}$/);
const context = Buffer.from("TennisFriend calendar link v1");
export class CalendarLinkConfigurationError extends Error {}
export class CalendarLinkSizeError extends Error {}
export class CalendarLinkExpiredError extends Error {}

function key() {
  const parsed = secretSchema.safeParse(process.env.CALENDAR_LINK_SECRET);
  if (!parsed.success) throw new CalendarLinkConfigurationError("Calendar link secret unavailable");
  return Buffer.from(parsed.data, "hex");
}

/** Authenticated encryption keeps event text out of readable URL parameters.
 * The URL is a bearer capability: anyone holding it may read this snapshot.
 * No raw event IDs, session tokens, or roster tokens are used as public access. */
export function sealCalendarLink(input: z.infer<typeof calendarLinkRequestSchema>, now = Date.now()) {
  const { id, payload } = calendarLinkRequestSchema.parse(input);
  const expiresAt = now + CALENDAR_LINK_LIFETIME_MS;
  const plaintext = Buffer.from(JSON.stringify({ id, payload, issuedAt: now, expiresAt }));
  if (plaintext.byteLength > CALENDAR_LINK_MAX_BYTES) throw new CalendarLinkSizeError("Event too large");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(context);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const token = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
  return { path: `/calendar/shared/${token}/event.ics`, expiresAt: new Date(expiresAt).toISOString() };
}

export function openCalendarLink(token: string, now = Date.now()) {
  if (!/^[A-Za-z0-9_-]{40,5600}$/.test(token)) throw new Error("Invalid link");
  const bytes = Buffer.from(token, "base64url");
  if (bytes.toString("base64url") !== token) throw new Error("Invalid link");
  const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
  decipher.setAAD(context);
  decipher.setAuthTag(bytes.subarray(12, 28));
  const plaintext = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
  const snapshot = snapshotSchema.parse(JSON.parse(plaintext.toString("utf8")));
  if (snapshot.expiresAt <= now) throw new CalendarLinkExpiredError("Link expired");
  return snapshot;
}

/** Optional public host for links minted by an authorized local test server. */
export function calendarLinkBaseUrl(): string | undefined {
  if (!process.env.CALENDAR_LINK_BASE_URL) return undefined;
  const parsed = z.string().url().safeParse(process.env.CALENDAR_LINK_BASE_URL);
  if (!parsed.success) throw new CalendarLinkConfigurationError("Invalid calendar link host");
  const url = new URL(parsed.data);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new CalendarLinkConfigurationError("Calendar link host must be an HTTPS origin");
  }
  return url.origin;
}
