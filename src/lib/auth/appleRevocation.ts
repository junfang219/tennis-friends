import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const clientId = "com.tennisfriend.app";
const exchangeResponse = z.object({ refresh_token: z.string().min(1), id_token: z.string().min(1) });
const appleClaims = z.object({ iss: z.literal("https://appleid.apple.com"), aud: z.literal(clientId), sub: z.string().min(1) });
const appleCredentials = z.object({ secret: z.string().min(1), encryptionKey: z.base64() });

function credentials() {
  const parsed = appleCredentials.safeParse({
    secret: process.env.APPLE_NATIVE_CLIENT_SECRET,
    encryptionKey: process.env.APPLE_REVOCATION_ENCRYPTION_KEY,
  });
  if (!parsed.success) return null;
  const key = Buffer.from(parsed.data.encryptionKey, "base64");
  return key.length === 32 ? { secret: parsed.data.secret, key } : null;
}
function appleIdentity(user: User) {
  return user.identities?.find(identity => identity.provider === "apple");
}
async function appleRequest(endpoint: "token" | "revoke", secret: string, fields: Record<string, string>) {
  return fetch("https://appleid.apple.com/auth/" + endpoint, {
    method: "POST",
    body: new URLSearchParams({ ...fields, client_id: clientId, client_secret: secret }),
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  });
}
export async function storeAppleAuthorization(user: User, code: string) {
  const identity = appleIdentity(user);
  const config = credentials();
  if (!identity || !config) return false;
  const response = await appleRequest("token", config.secret, { grant_type: "authorization_code", code });
  if (!response.ok) return false;
  const token = exchangeResponse.safeParse(await response.json());
  if (!token.success) return false;
  // Claims come straight from Apple's token endpoint. Verify that the grant
  // belongs to the independently authenticated Supabase identity.
  const payload = token.data.id_token.split(".")[1] ?? "";
  const claims = appleClaims.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString()));
  if (!claims.success || claims.data.sub !== identity.identity_data?.sub) return false;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.key, iv);
  cipher.setAAD(Buffer.from(user.id));
  const encrypted = Buffer.concat([cipher.update(token.data.refresh_token, "utf8"), cipher.final()]);
  const ciphertext = [iv, cipher.getAuthTag(), encrypted].map(part => part.toString("base64url")).join(".");
  const { error } = await createSupabaseAdminClient().from("apple_account_tokens").upsert({ user_id: user.id, ciphertext });
  return !error;
}
export async function needsManualAppleRevocation(user: User, admin: ReturnType<typeof createSupabaseAdminClient>) {
  const providers: unknown = user.app_metadata.providers;
  if (!appleIdentity(user) && user.app_metadata.provider !== "apple" && !(Array.isArray(providers) && providers.includes("apple"))) {
    return false;
  }
  try {
    const config = credentials();
    if (!config) return true;
    const { data, error } = await admin.from("apple_account_tokens").select("ciphertext").eq("user_id", user.id).maybeSingle();
    if (error || !data) return true;
    const [iv, tag, encrypted] = data.ciphertext.split(".").map(part => Buffer.from(part, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", config.key, iv);
    decipher.setAAD(Buffer.from(user.id));
    decipher.setAuthTag(tag);
    const token = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString();
    return !(await appleRequest("revoke", config.secret, { token, token_type_hint: "refresh_token" })).ok;
  } catch {
    return true;
  }
}
