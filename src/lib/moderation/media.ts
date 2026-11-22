import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { publicSupabaseUrl } from "@/lib/supabase/env";
import { objectKeyFromPublicUrl, STORAGE_BUCKETS } from "@/lib/supabase/storage";

const bucket = STORAGE_BUCKETS.posts;
const objectPrefix = `/storage/v1/object/public/${bucket}/`;
const renderPrefix = `/storage/v1/render/image/public/${bucket}/`;
const batchSize = 100;

function ownedObject(value: string, origin: string, authorId: string) {
  try {
    const url = new URL(value);
    if (url.origin !== origin || url.username || url.password) return null;
    const path = url.pathname.startsWith(renderPrefix)
      ? objectPrefix + url.pathname.slice(renderPrefix.length)
      : url.pathname;
    const key = path.startsWith(objectPrefix) ? objectKeyFromPublicUrl(path, bucket) : null;
    if (!key) return null;
    const [owner, filename, extra] = key.split("/");
    if (owner !== authorId || !filename || extra !== undefined || !/^[a-z0-9][a-z0-9._-]*$/i.test(filename)) return null;
    return { url: origin + objectPrefix + key, key };
  } catch {
    return null;
  }
}

export async function cleanupModeratedMedia(admin: ReturnType<typeof createSupabaseAdminClient>, reportId: string) {
  const { data: job, error } = await admin.from("moderation_media_cleanup")
    .select("author_id, media_urls").eq("report_id", reportId).maybeSingle();
  if (error) throw error;
  if (!job) return;

  const origin = new URL(publicSupabaseUrl()).origin;
  const objects = new Map<string, string>();
  for (const candidate of job.media_urls) {
    const object = ownedObject(candidate, origin, job.author_id);
    if (object) objects.set(object.url, object.key);
  }
  const urls = [...objects.keys()];
  for (let offset = 0; offset < urls.length; offset += batchSize) {
    const { data: unused, error: referenceError } = await admin.rpc("moderation_unreferenced_media", {
      p_urls: urls.slice(offset, offset + batchSize),
    });
    if (referenceError) throw referenceError;
    const paths = unused.flatMap(url => {
      const path = objects.get(url);
      return path ? [path] : [];
    });
    if (paths.length === 0) continue;
    const { error: removalError } = await admin.storage.from(bucket).remove(paths);
    if (removalError) throw removalError;
  }
  const { error: finishError } = await admin.from("moderation_media_cleanup").delete().eq("report_id", reportId);
  if (finishError) throw finishError;
}
