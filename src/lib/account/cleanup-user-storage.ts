import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STORAGE_BUCKETS, type StorageBucket } from "@/lib/supabase/storage";

// Every object uploaded by a user lives under `{userId}/...` (see
// buildObjectKey in lib/supabase/storage.ts). Listing that prefix and
// removing the results clears all of a user's uploads from a bucket.
//
// We list page-by-page because Supabase Storage caps each `list` call at
// 100 entries by default. A user with hundreds of post photos would
// otherwise leave the long tail behind.
const PAGE_SIZE = 100;

const ALL_BUCKETS = Object.values(STORAGE_BUCKETS) as StorageBucket[];

export interface StorageCleanupResult {
  bucket: StorageBucket;
  removed: number;
  error?: string;
}

async function removeAllForBucket(
  admin: SupabaseClient,
  bucket: StorageBucket,
  userId: string,
): Promise<StorageCleanupResult> {
  const storage = admin.storage.from(bucket);
  const prefix = `${userId}/`;
  let removed = 0;

  while (true) {
    const { data, error } = await storage.list(userId, {
      limit: PAGE_SIZE,
      offset: 0,
    });
    if (error) {
      return { bucket, removed, error: error.message };
    }
    if (!data || data.length === 0) return { bucket, removed };

    const paths = data.map((entry) => `${prefix}${entry.name}`);
    const { error: rmError } = await storage.remove(paths);
    if (rmError) {
      return { bucket, removed, error: rmError.message };
    }
    removed += paths.length;

    // Fewer than PAGE_SIZE means we're at the end. Otherwise loop —
    // remove() shrinks the listing so offset stays at 0 each time.
    if (data.length < PAGE_SIZE) return { bucket, removed };
  }
}

// Removes every storage object owned by `userId` across all app buckets.
// Returns per-bucket results so the caller can surface partial failures
// without aborting the rest of the account-delete flow.
export async function cleanupUserStorage(
  admin: SupabaseClient,
  userId: string,
): Promise<StorageCleanupResult[]> {
  if (!userId) throw new Error("cleanupUserStorage: userId is required");

  const results: StorageCleanupResult[] = [];
  for (const bucket of ALL_BUCKETS) {
    results.push(await removeAllForBucket(admin, bucket, userId));
  }
  return results;
}
