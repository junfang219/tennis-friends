import type { User } from "@supabase/supabase-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { needsManualAppleRevocation, storeAppleAuthorization } from "./appleRevocation";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

const fake = vi.hoisted(() => ({ from: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ from: fake.from }) }));
const userId = "11111111-1111-4111-8111-111111111111";
const user: User = {
  id: userId,
  aud: "authenticated",
  created_at: "2026-11-22T00:00:00Z",
  user_metadata: {},
  identities: [{ id: "apple-test-user", identity_id: "apple-test-user", user_id: userId, provider: "apple", identity_data: { sub: "apple-test-user" } }],
  app_metadata: { provider: "apple" },
};
const admin = { from: fake.from } as unknown as ReturnType<typeof createSupabaseAdminClient>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fake.fetch);
  vi.stubEnv("APPLE_NATIVE_CLIENT_SECRET", "fixture-client-secret");
  vi.stubEnv("APPLE_REVOCATION_ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function appleResponse(sub: string) {
  const claims = Buffer.from(JSON.stringify({
    iss: "https://appleid.apple.com", aud: "com.tennisfriend.app", sub,
  })).toString("base64url");
  return Response.json({ refresh_token: "fixture-refresh-token", id_token: "header." + claims + ".signature" });
}

it("encrypts the linked Apple grant and revokes it on deletion", async () => {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  fake.from.mockReturnValueOnce({ upsert });
  fake.fetch.mockResolvedValueOnce(appleResponse("apple-test-user"));
  expect(await storeAppleAuthorization(user, "fixture-code")).toBe(true);
  const stored = upsert.mock.calls[0][0];
  expect(stored.user_id).toBe(user.id);
  expect(stored.ciphertext).not.toContain("fixture-refresh-token");

  const maybeSingle = vi.fn().mockResolvedValue({ data: stored, error: null });
  fake.from.mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle }) }) });
  fake.fetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
  expect(await needsManualAppleRevocation(user, admin)).toBe(false);
  expect(fake.fetch.mock.calls[1][0]).toBe("https://appleid.apple.com/auth/revoke");
  expect(fake.fetch.mock.calls[1][1].body.get("token")).toBe("fixture-refresh-token");
});

it("rejects an Apple grant for a different identity", async () => {
  fake.fetch.mockResolvedValueOnce(appleResponse("other-user"));
  expect(await storeAppleAuthorization(user, "fixture-code")).toBe(false);
  expect(fake.from).not.toHaveBeenCalled();
});

it("requests manual revocation when no token is available and lets other users delete normally", async () => {
  fake.from.mockReturnValueOnce({ select: () => ({ eq: () => ({
    maybeSingle: async () => ({ data: null, error: null }),
  }) }) });
  expect(await needsManualAppleRevocation(user, admin)).toBe(true);
  expect(await needsManualAppleRevocation({ ...user, identities: [], app_metadata: { provider: "email" } }, admin)).toBe(false);
  expect(fake.fetch).not.toHaveBeenCalled();
});
