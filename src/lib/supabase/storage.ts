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

// Active-content MIME types we never accept anywhere, even in the
// generic `files` bucket. SVG, HTML, and JS can execute script when
// fetched inline, which means a uploaded file could XSS another user
// who opens its public/signed URL. Native binaries are filtered too
// to keep storage from being a malware-hosting CDN.
const DANGEROUS_MIME = new Set([
  "image/svg+xml",
  "text/html",
  "application/xhtml+xml",
  "application/javascript",
  "text/javascript",
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-executable",
  "application/x-sh",
  "application/x-bat",
  "application/vnd.microsoft.portable-executable",
]);

export function isMimeDangerous(mime: string): boolean {
  return DANGEROUS_MIME.has(mime.toLowerCase());
}

export function bucketAcceptsMime(bucket: StorageBucket, mime: string): boolean {
  if (isMimeDangerous(mime)) return false;
  switch (bucket) {
    case "avatars":
    case "court-reviews":
      return IMAGE_MIME.has(mime) && mime !== "image/heic";
    case "posts":
    case "albums":
      return IMAGE_MIME.has(mime) || VIDEO_MIME.has(mime);
    case "files":
      // After the dangerous-MIME gate above, accept anything else so
      // team uploads can include the long tail (pdf, docx, zip, etc.)
      // without us maintaining an exhaustive allowlist.
      return true;
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

// Rewrite a public Supabase Storage object URL to use the on-the-fly
// image transformer. The transformer returns a resized + Accept-negotiated
// (webp/avif) version of the source image, which lets us serve a small
// grid thumbnail without shipping the 2-10 MB original.
//
// Any URL that isn't shaped like a Supabase public-object URL — including
// videos and externally-hosted images — is returned unchanged so callers
// can safely pipe every image URL through this helper.
const PUBLIC_OBJECT_MARKER = "/storage/v1/object/public/";

export function publicStorageThumbUrl(
  url: string,
  opts: {
    width: number;
    height?: number;
    resize?: "cover" | "contain" | "fill";
    quality?: number;
  }
): string {
  const idx = url.indexOf(PUBLIC_OBJECT_MARKER);
  if (idx === -1) return url;
  const prefix = url.slice(0, idx);
  const rest = url.slice(idx + PUBLIC_OBJECT_MARKER.length);
  const params = new URLSearchParams();
  params.set("width", String(opts.width));
  if (opts.height != null) params.set("height", String(opts.height));
  params.set("resize", opts.resize ?? "cover");
  params.set("quality", String(opts.quality ?? 75));
  return `${prefix}/storage/v1/render/image/public/${rest}?${params.toString()}`;
}
