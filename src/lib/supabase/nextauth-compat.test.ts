import { describe, expect, it } from "vitest";

// Smoke tests for the NextAuth compat shim. Real auth behavior is exercised
// by the integration suite (sign-in via password etc.). Here we just lock in
// the public shape so future refactors don't silently break consumers.

describe("nextauth-compat shim", () => {
  it("exports the four NextAuth-compat surfaces", async () => {
    const mod = await import("./nextauth-compat");
    expect(typeof mod.useSession).toBe("function");
    expect(typeof mod.signIn).toBe("function");
    expect(typeof mod.signOut).toBe("function");
    expect(typeof mod.getProviders).toBe("function");
  });

  it("signIn rejects unsupported providers", async () => {
    const { signIn } = await import("./nextauth-compat");
    // "phone-otp" was the legacy NextAuth credentials provider — must not
    // silently fall through to OAuth.
    const result = await signIn("phone-otp");
    expect(result?.ok).toBe(false);
    expect(result?.error).toMatch(/not supported/);
  });

  it("getProviders returns null (legacy NextAuth surface has no equivalent)", async () => {
    const { getProviders } = await import("./nextauth-compat");
    expect(await getProviders()).toBeNull();
  });
});
