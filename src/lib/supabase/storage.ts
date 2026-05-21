// Shared helpers for Supabase Storage interactions.

export const STORAGE_BUCKETS = {
  avatars: "avatars",
  posts: "posts",
  albums: "albums",
  files: "files",
  courtReviews: "court-reviews",
} as const;

export type StorageBucket = (typeof STORAGE_BUCKETS)[keyof typeof STORAGE_BUCKETS];

// Per-bucket max size in bytes. Mirrored from the storage_buckets SQL migration
// so the client can fail fast before round-tripping a too-big file.
export const BUCKET_MAX_BYTES: Record<StorageBucket, number> = {
  avatars: 10 * 1024 * 1024,
  posts: 100 * 1024 * 1024,
  albums: 100 * 1024 * 1024,
  files: 100 * 1024 * 1024,
  "court-reviews": 10 * 1024 * 1024,
};

const IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
]);
const VIDEO_MIME = new Set(["video/mp4", "video/webm", "video/quicktime"]);

export function bucketAcceptsMime(bucket: StorageBucket, mime: string): boolean {
  switch (bucket) {
    case "avatars":
    case "court-reviews":
      return IMAGE_MIME.has(mime) && mime !== "image/heic";
    case "posts":
    case "albums":
      return IMAGE_MIME.has(mime) || VIDEO_MIME.has(mime);
    case "files":
      return true; // any mime allowed
    default:
      return false;
  }
}

// Build the object key for an upload. First segment is the owner uuid so the
// storage RLS policy `(storage.foldername(name))[1] = auth.uid()::text` matches.
export function buildObjectKey(
  userId: string,
  originalFilename: string
): string {
  const ext = originalFilename.includes(".")
    ? originalFilename.slice(originalFilename.lastIndexOf(".") + 1).toLowerCase()
    : "bin";
  const safeExt = ext.replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
  const timestamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  return `${userId}/${timestamp}-${rand}.${safeExt}`;
}

export function inferMediaTypeFromMime(mime: string): "image" | "video" | null {
  if (IMAGE_MIME.has(mime)) return "image";
  if (VIDEO_MIME.has(mime)) return "video";
  return null;
}
