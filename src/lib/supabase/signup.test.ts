import { describe, expect, it } from "vitest";
import { emailExists, isExistingEmailSignUp } from "./signup";

// Minimal fake of the parts of the Supabase client emailExists touches.
type RpcImpl = (
  fn: string,
  args: { p_email: string }
) => Promise<{ data: unknown; error: unknown }>;
const fakeClient = (rpc: RpcImpl) =>
  ({ rpc }) as unknown as Parameters<typeof emailExists>[0];

// The helper only reads `identities` + `session`, so plain stubs suffice.
const user = (identities: unknown[] | undefined) => ({ id: "u1", identities });

describe("isExistingEmailSignUp", () => {
  it("true when confirmation is pending and identities is empty (duplicate email)", () => {
    expect(isExistingEmailSignUp({ user: user([]), session: null })).toBe(true);
  });

  it("false for a genuine new signup awaiting confirmation (has an identity)", () => {
    expect(
      isExistingEmailSignUp({ user: user([{ id: "i1" }]), session: null })
    ).toBe(false);
  });

  it("false when a session was returned (confirmation disabled, real signup)", () => {
    expect(
      isExistingEmailSignUp({ user: user([]), session: { access_token: "t" } })
    ).toBe(false);
  });

  it("false when there is no user", () => {
    expect(isExistingEmailSignUp({ user: null, session: null })).toBe(false);
  });

  it("false when identities is missing entirely", () => {
    expect(
      isExistingEmailSignUp({ user: user(undefined), session: null })
    ).toBe(false);
  });
});

describe("emailExists", () => {
  it("returns true when the RPC reports the email exists", async () => {
    const client = fakeClient(async () => ({ data: true, error: null }));
    expect(await emailExists(client, "a@b.com")).toBe(true);
  });

  it("returns false when the RPC reports no match", async () => {
    const client = fakeClient(async () => ({ data: false, error: null }));
    expect(await emailExists(client, "a@b.com")).toBe(false);
  });

  it("trims the email before sending it to the RPC", async () => {
    let sent: { p_email: string } | undefined;
    const client = fakeClient(async (_fn, args) => {
      sent = args;
      return { data: false, error: null };
    });
    await emailExists(client, "  a@b.com  ");
    expect(sent).toEqual({ p_email: "a@b.com" });
  });

  it("throws when the RPC returns an error", async () => {
    const client = fakeClient(async () => ({
      data: null,
      error: { message: "boom" },
    }));
    await expect(emailExists(client, "a@b.com")).rejects.toBeTruthy();
  });
});
