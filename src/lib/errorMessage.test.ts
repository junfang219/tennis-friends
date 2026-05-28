import { describe, expect, it } from "vitest";
import { errorMessage, toError, toErrorMessage } from "./errorMessage";

describe("toErrorMessage", () => {
  it("returns the message of Error instances", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("unwraps a Supabase PostgrestError-shaped object", () => {
    expect(
      toErrorMessage({
        message: "new row violates row-level security policy",
        code: "42501",
        details: null,
        hint: null,
      })
    ).toBe("new row violates row-level security policy");
  });

  it("returns null when no usable message exists", () => {
    expect(toErrorMessage("plain string")).toBeNull();
    expect(toErrorMessage(42)).toBeNull();
    expect(toErrorMessage(null)).toBeNull();
    expect(toErrorMessage(undefined)).toBeNull();
    expect(toErrorMessage({ code: "X" })).toBeNull();
    expect(toErrorMessage({ message: 123 })).toBeNull();
  });
});

describe("errorMessage", () => {
  it("falls back when no message is available", () => {
    expect(errorMessage("nope", "Couldn't save.")).toBe("Couldn't save.");
    expect(errorMessage({ code: "X" }, "Couldn't save.")).toBe("Couldn't save.");
  });

  it("returns the real message when present", () => {
    expect(errorMessage(new Error("boom"), "fallback")).toBe("boom");
    expect(errorMessage({ message: "rls" }, "fallback")).toBe("rls");
  });
});

describe("toError", () => {
  it("passes Error instances through unchanged", () => {
    const e = new Error("x");
    expect(toError(e)).toBe(e);
  });

  it("wraps PostgrestError-shaped objects and copies fields", () => {
    const pg = { message: "permission denied", code: "42501", hint: "check RLS" };
    const e = toError(pg);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("permission denied");
    expect((e as Error & { code?: string }).code).toBe("42501");
    expect((e as Error & { hint?: string }).hint).toBe("check RLS");
  });

  it("falls back to String() for unstructured values", () => {
    expect(toError("oops").message).toBe("oops");
    expect(toError(null).message).toBe("null");
    expect(toError({ no: "msg" }).message).toBe("[object Object]");
  });
});
