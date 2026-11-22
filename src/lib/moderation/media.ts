import "server-only";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseManagedMediaPath, type ScreenedMediaBucket } from "@/lib/supabase/storage";
import { reviewableMediaUrl } from "./server";

const batchSize = 100;

export async function cleanupModeratedMedia(admin: ReturnType<typeof createSupabaseAdminClient>, reportId: string) {
  const { data: job, error } = await admin.from("moderation_media_cleanup")
    .select("author_id, media_urls").eq("report_id", reportId).maybeSingle();
  if (error) throw error;
  if (!job) return;

  const objects = new Map<string, { bucket: ScreenedMediaBucket; key: string }>();
  for (const candidate of job.media_urls) {
    const url = reviewableMediaUrl(candidate);
    if (!url) continue;
    const object = parseManagedMediaPath(url);
    if (object?.owner === job.author_id) objects.set(url, object);
  }
  const urls = [...objects.keys()];
  for (let offset = 0; offset < urls.length; offset += batchSize) {
    const { data: unused, error: referenceError } = await admin.rpc("moderation_unreferenced_media", {
      p_urls: urls.slice(offset, offset + batchSize),
    });
    if (referenceError) throw referenceError;
    const pathsByBucket = new Map<ScreenedMediaBucket, string[]>();
    for (const url of unused) {
      const object = objects.get(url);
      if (!object) continue;
      const paths = pathsByBucket.get(object.bucket) ?? [];
      paths.push(object.key);
      pathsByBucket.set(object.bucket, paths);
    }
    for (const [bucket, paths] of pathsByBucket) {
      const { error: removalError } = await admin.storage.from(bucket).remove(paths);
      if (removalError) throw removalError;
    }
  }
  const { error: finishError } = await admin.from("moderation_media_cleanup").delete().eq("report_id", reportId);
  if (finishError) throw finishError;
}
