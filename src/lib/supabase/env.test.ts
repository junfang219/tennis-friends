import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// This is a static-analysis test — it inspects the env.ts source instead of
// executing the functions. The bug we're guarding against was: using
// `process.env[name]` (dynamic key) for NEXT_PUBLIC_ vars. That works on the
// server (Node reads process.env at runtime) but fails in the browser bundle:
// Next.js / Webpack only replaces `process.env.NEXT_PUBLIC_X` with the
// build-time value when it sees the *literal* form. Dynamic key access
// compiles to a runtime `process.env` lookup → undefined in browsers →
// thrown "Missing required env var" when client code calls a Supabase helper.

const ENV_PATH = resolve(__dirname, "env.ts");

describe("env.ts inlining requirement", () => {
  const source = readFileSync(ENV_PATH, "utf8");

  it("reads each NEXT_PUBLIC_ var via the LITERAL process.env.NAME form (so Webpack inlines it)", () => {
    expect(source).toContain("process.env.NEXT_PUBLIC_SUPABASE_URL");
    expect(source).toContain("process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  });

  it("does NOT use process.env[dynamicKey] for the public vars (that pattern breaks client bundles)", () => {
    // The whole file is small enough that any process.env[...] indexing is
    // suspicious. If a future helper needs dynamic env access it must read
    // from a server-only entry point.
    expect(source).not.toMatch(/process\.env\[/);
  });
});
