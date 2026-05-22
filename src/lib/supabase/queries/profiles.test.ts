import { describe, expect, it, vi } from "vitest";
import { searchProfiles } from "./profiles";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";

// Tiny fake of supabase.from(...).select(...).eq(...).limit(...) that
// records every filter call so we can assert what was sent to PostgREST
// without standing up a real Supabase client.
function makeFakeClient(opts: { user: { id: string } | null }) {
  const calls: { op: string; args: unknown[] }[] = [];
  const q: Record<string, unknown> = {};
  const record = (op: string) => (...args: unknown[]) => {
    calls.push({ op, args });
    return q;
  };
  q.select = record("select");
  q.eq = record("eq");
  q.neq = record("neq");
  q.gte = record("gte");
  q.lte = record("lte");
  q.limit = vi.fn(async (n: number) => {
    calls.push({ op: "limit", args: [n] });
    return { data: [], error: null };
  });

  const client = {
    from: vi.fn(() => q),
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: opts.user },
        error: null,
      })),
    },
  } as unknown as SupabaseClient<Database>;

  return { client, calls };
}

describe("searchProfiles", () => {
  it("filters out the currently signed-in user (id != auth.uid())", async () => {
    const { client, calls } = makeFakeClient({ user: { id: "user-123" } });
    await searchProfiles(client);
    const neqIds = calls.filter((c) => c.op === "neq" && c.args[0] === "id");
    expect(neqIds).toHaveLength(1);
    expect(neqIds[0]?.args[1]).toBe("user-123");
  });

  it("omits the self-exclusion filter when no user is signed in", async () => {
    const { client, calls } = makeFakeClient({ user: null });
    await searchProfiles(client);
    const neqIds = calls.filter((c) => c.op === "neq" && c.args[0] === "id");
    expect(neqIds).toHaveLength(0);
  });

  it("still applies the always-on completeness filters even without a user", async () => {
    const { client, calls } = makeFakeClient({ user: null });
    await searchProfiles(client);
    // onboarding_complete = true
    const eqOnboarding = calls.find(
      (c) => c.op === "eq" && c.args[0] === "onboarding_complete"
    );
    expect(eqOnboarding?.args[1]).toBe(true);
    // name != ""
    const neqName = calls.find((c) => c.op === "neq" && c.args[0] === "name");
    expect(neqName?.args[1]).toBe("");
  });
});
