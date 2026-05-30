import { describe, expect, it } from "vitest";
import { isExistingEmailSignUp } from "./signup";

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
