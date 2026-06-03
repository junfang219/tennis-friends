import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanupUserStorage } from "./cleanup-user-storage";
import { STORAGE_BUCKETS } from "@/lib/supabase/storage";

// Build a fake Supabase client whose .storage.from(bucket) returns a
// per-bucket list/remove pair. The factory takes a map of bucket → fake
// listings so each test can describe exactly what storage looks like.
function fakeClient(
  listingsByBucket: Record<string, Array<{ name: string }[]>>,
): { client: SupabaseClient; calls: { bucket: string; removed: string[] }[] } {
  const calls: { bucket: string; removed: string[] }[] = [];
  const client = {
    storage: {
      from(bucket: string) {
        const pages = [...(listingsByBucket[bucket] ?? [])];
        return {
          list: vi.fn(async () => ({
            data: pages.shift() ?? [],
            error: null,
          })),
          remove: vi.fn(async (paths: string[]) => {
            calls.push({ bucket, removed: paths });
            return { data: paths, error: null };
          }),
        };
      },
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("cleanupUserStorage", () => {
  const USER_ID = "11111111-2222-3333-4444-555555555555";

  it("rejects an empty userId — guards against accidentally wiping a bucket root", async () => {
    const { client } = fakeClient({});
    await expect(cleanupUserStorage(client, "")).rejects.toThrow(/userId/);
  });

  it("walks every app bucket and reports per-bucket results", async () => {
    const { client } = fakeClient({}); // every bucket empty
    const results = await cleanupUserStorage(client, USER_ID);
    expect(results.map((r) => r.bucket).sort()).toEqual(
      Object.values(STORAGE_BUCKETS).sort(),
    );
    for (const r of results) {
      expect(r.removed).toBe(0);
      expect(r.error).toBeUndefined();
    }
  });

  it("prefixes removed paths with the user folder so RLS storage policies authorize the delete", async () => {
    const { client, calls } = fakeClient({
      avatars: [[{ name: "1700-abc.jpg" }]],
      posts: [[{ name: "1701-def.heic" }, { name: "1702-ghi.mp4" }]],
    });
    await cleanupUserStorage(client, USER_ID);
    const avatarsCall = calls.find((c) => c.bucket === "avatars");
    const postsCall = calls.find((c) => c.bucket === "posts");
    expect(avatarsCall?.removed).toEqual([`${USER_ID}/1700-abc.jpg`]);
    expect(postsCall?.removed).toEqual([
      `${USER_ID}/1701-def.heic`,
      `${USER_ID}/1702-ghi.mp4`,
    ]);
  });

  it("pages through buckets that hold more than 100 objects", async () => {
    // Two full pages of 100 + one trailing page of 50 — verifies the loop
    // exits on the short page rather than spinning forever.
    const full = Array.from({ length: 100 }, (_, i) => ({ name: `f${i}.jpg` }));
    const tail = Array.from({ length: 50 }, (_, i) => ({ name: `t${i}.jpg` }));
    const { client, calls } = fakeClient({
      avatars: [full, full, tail],
    });
    const results = await cleanupUserStorage(client, USER_ID);
    const avatarsResult = results.find((r) => r.bucket === "avatars");
    expect(avatarsResult?.removed).toBe(250);
    expect(calls.filter((c) => c.bucket === "avatars").length).toBe(3);
  });

  it("captures the error message instead of throwing so other buckets still get cleaned", async () => {
    const failingClient = {
      storage: {
        from(bucket: string) {
          return {
            list: vi.fn(async () =>
              bucket === "posts"
                ? { data: null, error: { message: "boom" } }
                : { data: [], error: null },
            ),
            remove: vi.fn(async () => ({ data: [], error: null })),
          };
        },
      },
    } as unknown as SupabaseClient;
    const results = await cleanupUserStorage(failingClient, USER_ID);
    const posts = results.find((r) => r.bucket === "posts");
    expect(posts?.error).toBe("boom");
    // Other buckets still completed cleanly — caller decides whether to abort.
    const avatars = results.find((r) => r.bucket === "avatars");
    expect(avatars?.error).toBeUndefined();
  });
});
