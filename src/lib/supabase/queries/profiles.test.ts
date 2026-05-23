import { describe, expect, it, vi } from "vitest";
import { searchProfiles, updateMyProfile } from "./profiles";
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
  q.not = record("not");
  q.gte = record("gte");
  q.lte = record("lte");
  q.limit = vi.fn(async (n: number) => {
    calls.push({ op: "limit", args: [n] });
    return { data: [], error: null };
  });
  // .or() is the terminus for the friendships lookup searchProfiles now
  // does to filter out accepted friends. Resolve to an empty list so the
  // existing test assertions on the profile query are unaffected.
  q.or = vi.fn(async (filter: string) => {
    calls.push({ op: "or", args: [filter] });
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

// Mirror-to-auth contract for updateMyProfile. The useSession compat shim
// reads name + avatar from auth.user_metadata, so updates to the profiles
// row must also write the same keys to user_metadata. Otherwise the
// navbar + composer keep rendering the signup-time initials/avatar after
// the user edits their name or profile photo.
function makeUpdateClient(opts: {
  user: { id: string };
  updatedRow: Record<string, unknown>;
}) {
  const updateUserSpy = vi.fn(async () => ({ data: { user: null }, error: null }));
  const q: Record<string, unknown> = {};
  const passthrough = () => q;
  q.update = passthrough;
  q.eq = passthrough;
  q.select = passthrough;
  q.single = vi.fn(async () => ({ data: opts.updatedRow, error: null }));
  const client = {
    from: vi.fn(() => q),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: opts.user }, error: null })),
      updateUser: updateUserSpy,
    },
  } as unknown as SupabaseClient<Database>;
  return { client, updateUserSpy };
}

describe("updateMyProfile mirrors to auth.user_metadata", () => {
  it("writes name to user_metadata.name when patch.name changes", async () => {
    const { client, updateUserSpy } = makeUpdateClient({
      user: { id: "u1" },
      updatedRow: { id: "u1", name: "Mimi Fang" },
    });
    await updateMyProfile(client, { name: "Mimi Fang" });
    expect(updateUserSpy).toHaveBeenCalledWith({
      data: { name: "Mimi Fang" },
    });
  });

  it("writes profile_image_url to user_metadata.avatar_url", async () => {
    const { client, updateUserSpy } = makeUpdateClient({
      user: { id: "u1" },
      updatedRow: { id: "u1", profile_image_url: "https://x/y.png" },
    });
    await updateMyProfile(client, { profile_image_url: "https://x/y.png" });
    expect(updateUserSpy).toHaveBeenCalledWith({
      data: { avatar_url: "https://x/y.png" },
    });
  });

  it("merges name + avatar in a single auth.updateUser call", async () => {
    const { client, updateUserSpy } = makeUpdateClient({
      user: { id: "u1" },
      updatedRow: { id: "u1" },
    });
    await updateMyProfile(client, {
      name: "Mimi Fang",
      profile_image_url: "https://x/y.png",
    });
    expect(updateUserSpy).toHaveBeenCalledTimes(1);
    expect(updateUserSpy).toHaveBeenCalledWith({
      data: { name: "Mimi Fang", avatar_url: "https://x/y.png" },
    });
  });

  it("skips the auth roundtrip when patch touches neither name nor avatar", async () => {
    const { client, updateUserSpy } = makeUpdateClient({
      user: { id: "u1" },
      updatedRow: { id: "u1", latitude: 47.6, longitude: -122.3 },
    });
    await updateMyProfile(client, { latitude: 47.6, longitude: -122.3 });
    expect(updateUserSpy).not.toHaveBeenCalled();
  });
});
