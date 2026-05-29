import { describe, expect, it } from "vitest";
import {
  BUCKET_MAX_BYTES,
  bucketAcceptsMime,
  buildObjectKey,
  inferMediaTypeFromMime,
  objectKeyFromPublicUrl,
  publicStorageThumbUrl,
} from "./storage";

describe("storage helpers", () => {
  describe("buildObjectKey", () => {
    it("places user id as the first path segment", () => {
      const key = buildObjectKey("11111111-2222-3333-4444-555555555555", "photo.jpg");
      expect(key.startsWith("11111111-2222-3333-4444-555555555555/")).toBe(true);
    });

    it("preserves a lowercased, sanitized extension", () => {
      expect(buildObjectKey("u", "Image.HEIC")).toMatch(/\.heic$/);
      expect(buildObjectKey("u", "doc.PDF")).toMatch(/\.pdf$/);
      expect(buildObjectKey("u", "weird name.tar.gz")).toMatch(/\.gz$/);
    });

    it("falls back to .bin when there is no extension", () => {
      expect(buildObjectKey("u", "noextension")).toMatch(/\.bin$/);
    });

    it("strips characters that would confuse storage policies", () => {
      const key = buildObjectKey("u", "file.j!p@g#");
      // Whatever the result, it should never escape the user's folder.
      expect(key.split("/")[0]).toBe("u");
      expect(key).not.toContain("..");
    });
  });

  describe("bucketAcceptsMime", () => {
    it("avatars accept common images but not HEIC", () => {
      expect(bucketAcceptsMime("avatars", "image/jpeg")).toBe(true);
      expect(bucketAcceptsMime("avatars", "image/png")).toBe(true);
      expect(bucketAcceptsMime("avatars", "image/heic")).toBe(false);
      expect(bucketAcceptsMime("avatars", "video/mp4")).toBe(false);
    });

    it("posts accept images and videos including HEIC + MOV", () => {
      expect(bucketAcceptsMime("posts", "image/heic")).toBe(true);
      expect(bucketAcceptsMime("posts", "video/quicktime")).toBe(true);
      expect(bucketAcceptsMime("posts", "video/mp4")).toBe(true);
      expect(bucketAcceptsMime("posts", "application/pdf")).toBe(false);
    });

    it("files accept any mime except the active-content denylist", () => {
      expect(bucketAcceptsMime("files", "application/pdf")).toBe(true);
      expect(bucketAcceptsMime("files", "application/zip")).toBe(true);
      expect(bucketAcceptsMime("files", "weird/whatever")).toBe(true);
    });

    it("rejects dangerous mimes across every bucket", () => {
      for (const bucket of ["avatars", "posts", "albums", "files", "court-reviews"] as const) {
        // SVG can execute JS when rendered inline; HTML/JS load script
        // directly. None of these should be uploadable, even to the
        // catch-all `files` bucket.
        expect(bucketAcceptsMime(bucket, "image/svg+xml")).toBe(false);
        expect(bucketAcceptsMime(bucket, "text/html")).toBe(false);
        expect(bucketAcceptsMime(bucket, "application/javascript")).toBe(false);
        expect(bucketAcceptsMime(bucket, "text/javascript")).toBe(false);
        expect(bucketAcceptsMime(bucket, "application/x-msdownload")).toBe(false);
      }
    });

    it("denylist is case-insensitive", () => {
      // Browsers tend to lowercase content-types, but tools and clients
      // can send "Image/SVG+XML". The gate must not be bypassable by
      // capitalisation.
      expect(bucketAcceptsMime("files", "Image/SVG+XML")).toBe(false);
      expect(bucketAcceptsMime("files", "TEXT/HTML")).toBe(false);
    });
  });

  describe("inferMediaTypeFromMime", () => {
    it("classifies image vs video vs other", () => {
      expect(inferMediaTypeFromMime("image/jpeg")).toBe("image");
      expect(inferMediaTypeFromMime("video/mp4")).toBe("video");
      expect(inferMediaTypeFromMime("application/pdf")).toBe(null);
    });
  });

  describe("publicStorageThumbUrl", () => {
    const ORIGIN = "https://fqopzafmnaviipumsmfm.supabase.co";
    const PUBLIC = `${ORIGIN}/storage/v1/object/public/albums/user-1/photo.jpeg`;

    it("rewrites the public-object URL onto the render endpoint", () => {
      const u = publicStorageThumbUrl(PUBLIC, { width: 400, height: 400 });
      expect(u.startsWith(`${ORIGIN}/storage/v1/render/image/public/albums/user-1/photo.jpeg?`)).toBe(true);
    });

    it("encodes the requested size + sensible defaults", () => {
      const u = new URL(publicStorageThumbUrl(PUBLIC, { width: 400, height: 300 }));
      expect(u.searchParams.get("width")).toBe("400");
      expect(u.searchParams.get("height")).toBe("300");
      // Defaults: cover-resize, quality 75 — keeps callers from having to repeat themselves.
      expect(u.searchParams.get("resize")).toBe("cover");
      expect(u.searchParams.get("quality")).toBe("75");
    });

    it("respects explicit resize + quality overrides", () => {
      const u = new URL(publicStorageThumbUrl(PUBLIC, { width: 800, resize: "contain", quality: 90 }));
      expect(u.searchParams.get("resize")).toBe("contain");
      expect(u.searchParams.get("quality")).toBe("90");
      // Omitted height stays omitted so the transformer scales by width alone.
      expect(u.searchParams.has("height")).toBe(false);
    });

    it("returns non-public-object URLs unchanged", () => {
      // Video URLs, external CDNs, and seed/default avatars should pass through
      // so the helper is safe to wrap every <img src> with.
      const passthroughs = [
        "https://example.com/photo.jpg",
        `${ORIGIN}/storage/v1/object/sign/albums/user-1/photo.jpeg?token=abc`,
        "/local/asset.png",
        "",
      ];
      for (const url of passthroughs) {
        expect(publicStorageThumbUrl(url, { width: 400, height: 400 })).toBe(url);
      }
    });
  });

  describe("objectKeyFromPublicUrl", () => {
    const ORIGIN = "https://fqopzafmnaviipumsmfm.supabase.co";

    it("recovers the object key for the matching bucket", () => {
      const url = `${ORIGIN}/storage/v1/object/public/files/uid-1/1700000000-abc.pdf`;
      expect(objectKeyFromPublicUrl(url, "files")).toBe("uid-1/1700000000-abc.pdf");
    });

    it("decodes percent-encoded segments", () => {
      const url = `${ORIGIN}/storage/v1/object/public/files/uid-1/my%20file%20name.pdf`;
      expect(objectKeyFromPublicUrl(url, "files")).toBe("uid-1/my file name.pdf");
    });

    it("returns null when the bucket segment doesn't match", () => {
      const url = `${ORIGIN}/storage/v1/object/public/albums/uid-1/photo.jpg`;
      expect(objectKeyFromPublicUrl(url, "files")).toBeNull();
    });

    it("returns null for signed or non-public-object URLs", () => {
      expect(
        objectKeyFromPublicUrl(`${ORIGIN}/storage/v1/object/sign/files/uid-1/x.pdf?token=abc`, "files")
      ).toBeNull();
      expect(objectKeyFromPublicUrl("https://example.com/x.pdf", "files")).toBeNull();
      expect(objectKeyFromPublicUrl("", "files")).toBeNull();
    });

    it("returns null when the key would be empty", () => {
      expect(objectKeyFromPublicUrl(`${ORIGIN}/storage/v1/object/public/files/`, "files")).toBeNull();
    });
  });

  describe("BUCKET_MAX_BYTES", () => {
    it("avatars and court-reviews are 10 MB", () => {
      expect(BUCKET_MAX_BYTES.avatars).toBe(10 * 1024 * 1024);
      expect(BUCKET_MAX_BYTES["court-reviews"]).toBe(10 * 1024 * 1024);
    });

    it("posts/albums/files are 100 MB", () => {
      expect(BUCKET_MAX_BYTES.posts).toBe(100 * 1024 * 1024);
      expect(BUCKET_MAX_BYTES.albums).toBe(100 * 1024 * 1024);
      expect(BUCKET_MAX_BYTES.files).toBe(100 * 1024 * 1024);
    });
  });
});
