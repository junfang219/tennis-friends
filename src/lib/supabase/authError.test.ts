import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./authError";

describe("authErrorMessage", () => {
  it("maps WebKit 'Load failed' to a connection message", () => {
    expect(authErrorMessage(new TypeError("Load failed"))).toMatch(
      /couldn't reach the server/i
    );
  });

  it("maps Chrome 'Failed to fetch' to a connection message", () => {
    expect(authErrorMessage(new TypeError("Failed to fetch"))).toMatch(
      /couldn't reach the server/i
    );
  });

  it("maps the email-send rate limit to a wait/try-again message", () => {
    expect(
      authErrorMessage({
        code: "over_email_send_rate_limit",
        status: 429,
        message: "email rate limit exceeded",
      })
    ).toMatch(/too many attempts/i);
  });

  it("maps invalid credentials to a friendly login error", () => {
    expect(
      authErrorMessage({ code: "invalid_credentials", status: 400 })
    ).toBe("Incorrect email or password.");
  });

  it("maps an already-registered email", () => {
    expect(authErrorMessage({ code: "user_already_exists" })).toMatch(
      /already exists/i
    );
  });

  it("falls back to a bare 429 status with no code", () => {
    expect(authErrorMessage({ status: 429 })).toMatch(/too many attempts/i);
  });

  it("passes through an unrecognized server message", () => {
    expect(authErrorMessage({ message: "Some specific server error" })).toBe(
      "Some specific server error"
    );
  });

  it("uses a generic fallback for an empty/unknown error", () => {
    expect(authErrorMessage(null)).toBe("Something went wrong. Please try again.");
  });
});
