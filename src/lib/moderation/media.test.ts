import { afterEach, expect, it, vi } from "vitest";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { cleanupModeratedMedia } from "./media";

const origin = "https://storage.example";
const prefix = "/storage/v1/object/public/posts/";
const owner = "11111111-1111-4111-8111-111111111111";
const reportId = "22222222-2222-4222-8222-222222222222";

function fixture(urls: string[], unreferenced: string[]) {
  const finish = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const rpc = vi.fn().mockResolvedValue({ data: unreferenced, error: null });
  const fromBucket = vi.fn(() => ({ remove }));
  const admin = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: { author_id: owner, media_urls: urls },
        error: null,
      }) }) }),
      delete: () => ({ eq: finish }),
    }),
    rpc,
    storage: { from: fromBucket },
  } as unknown as ReturnType<typeof createSupabaseAdminClient>;
  return { admin, remove, rpc, fromBucket, finish };
}

afterEach(() => vi.unstubAllEnvs());

it("removes only unreferenced, same-project objects under the reported author’s path", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", origin);
  const key = owner + "/1710-test.png";
  const owned = origin + prefix + key;
  const shared = origin + prefix + owner + "/1711-shared.mp4";
  const { admin, remove, rpc, fromBucket, finish } = fixture([
    owned,
    origin + "/storage/v1/render/image/public/posts/" + key + "?width=200",
    shared,
    origin + prefix + reportId + "/other-author.png",
    origin + "/storage/v1/object/public/avatars/" + key,
    "https://elsewhere.example" + prefix + key,
  ], [owned]);
  await cleanupModeratedMedia(admin, reportId);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("moderation_unreferenced_media", { p_urls: [owned, shared] });
  expect(fromBucket).toHaveBeenCalledWith("posts");
  expect(remove).toHaveBeenCalledExactlyOnceWith([key]);
  expect(finish).toHaveBeenCalledExactlyOnceWith("report_id", reportId);
});

it("keeps the cleanup job available if the storage request fails", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", origin);
  const url = origin + prefix + owner + "/1710-test.png";
  const { admin, remove, finish } = fixture([url], [url]);
  remove.mockResolvedValueOnce({ error: new Error("temporary storage failure") });
  await expect(cleanupModeratedMedia(admin, reportId)).rejects.toThrow("temporary storage failure");
  expect(finish).not.toHaveBeenCalled();
  await cleanupModeratedMedia(admin, reportId);
  expect(finish).toHaveBeenCalledOnce();
});
