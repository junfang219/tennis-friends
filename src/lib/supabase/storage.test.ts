import { describe, expect, it } from "vitest";
import {
  BUCKET_MAX_BYTES,
  bucketAcceptsMime,
  buildObjectKey,
  inferMediaTypeFromMime,
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

    it("files accept any mime", () => {
      expect(bucketAcceptsMime("files", "application/pdf")).toBe(true);
      expect(bucketAcceptsMime("files", "weird/whatever")).toBe(true);
    });
  });

  describe("inferMediaTypeFromMime", () => {
    it("classifies image vs video vs other", () => {
      expect(inferMediaTypeFromMime("image/jpeg")).toBe("image");
      expect(inferMediaTypeFromMime("video/mp4")).toBe("video");
      expect(inferMediaTypeFromMime("application/pdf")).toBe(null);
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
