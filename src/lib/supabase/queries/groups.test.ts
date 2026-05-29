import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  getGroup,
  listGroupMembers,
  getCachedGroup,
  getCachedGroupMembers,
  getCachedGroupBundle,
} from "./groups";
import { __resetForTests } from "../../queryCache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";

// Minimal fake of the two query shapes these helpers use:
//   groups:        from().select().eq().maybeSingle()
//   group_members: from().select().eq().is()  (terminal)
function makeClient(opts: {
  group: Record<string, unknown> | null;
  members: Record<string, unknown>[];
}) {
  const groupQ: Record<string, unknown> = {};
  groupQ.select = () => groupQ;
  groupQ.eq = () => groupQ;
  groupQ.maybeSingle = vi.fn(async () => ({ data: opts.group, error: null }));

  const membersQ: Record<string, unknown> = {};
  membersQ.select = () => membersQ;
  membersQ.eq = () => membersQ;
  membersQ.is = vi.fn(async () => ({ data: opts.members, error: null }));

  const client = {
    from: vi.fn((table: string) => (table === "groups" ? groupQ : membersQ)),
  } as unknown as SupabaseClient<Database>;
  return client;
}

describe("group header caching", () => {
  beforeEach(() => {
    __resetForTests();
  });

  it("getGroup populates the cache so tabs can read it synchronously", async () => {
    const client = makeClient({ group: { id: "g1", name: "Aces", owner_id: "u1" }, members: [] });
    expect(getCachedGroup("g1")).toBeUndefined();

    const g = await getGroup(client, "g1");
    expect(g?.name).toBe("Aces");
    expect(getCachedGroup("g1")?.name).toBe("Aces");
  });

  it("does not cache a missing group (maybeSingle → null)", async () => {
    const client = makeClient({ group: null, members: [] });
    const g = await getGroup(client, "ghost");
    expect(g).toBeNull();
    expect(getCachedGroup("ghost")).toBeUndefined();
  });

  it("listGroupMembers caches the member list (even when empty)", async () => {
    const client = makeClient({
      group: null,
      members: [{ id: "m1", user_id: "u1", role: "owner" }],
    });
    await listGroupMembers(client, "g1");
    expect(getCachedGroupMembers("g1")).toHaveLength(1);
  });

  it("getCachedGroupBundle returns null until BOTH sides are cached", async () => {
    const client = makeClient({
      group: { id: "g1", name: "Aces", owner_id: "u1" },
      members: [{ id: "m1", user_id: "u1", role: "owner" }],
    });
    await getGroup(client, "g1");
    // members not fetched yet → bundle incomplete
    expect(getCachedGroupBundle("g1")).toBeNull();

    await listGroupMembers(client, "g1");
    const bundle = getCachedGroupBundle("g1");
    expect(bundle?.group.name).toBe("Aces");
    expect(bundle?.members).toHaveLength(1);
  });

  it("scopes the cache by group id", async () => {
    const client = makeClient({ group: { id: "g1", name: "Aces", owner_id: "u1" }, members: [] });
    await getGroup(client, "g1");
    expect(getCachedGroup("g2")).toBeUndefined();
  });
});
