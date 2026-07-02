import { describe, expect, it } from "vitest";
import {
  computeScaledDimensions,
  shouldSkipDownscale,
  downscaleImage,
} from "./imageDownscale";

describe("computeScaledDimensions", () => {
  it("scales the longer edge down to maxEdge, preserving aspect ratio", () => {
    const r = computeScaledDimensions(4000, 3000, 2048);
    expect(r.width).toBe(2048);
    expect(r.height).toBe(1536);
    expect(r.scale).toBeCloseTo(0.512);
  });

  it("scales by the taller edge for portrait images", () => {
    const r = computeScaledDimensions(3000, 4000, 2048);
    expect(r.height).toBe(2048);
    expect(r.width).toBe(1536);
  });

  it("never upscales an image already within the cap", () => {
    const r = computeScaledDimensions(800, 600, 2048);
    expect(r).toEqual({ width: 800, height: 600, scale: 1 });
  });

  it("leaves an image exactly at the cap untouched", () => {
    const r = computeScaledDimensions(2048, 1000, 2048);
    expect(r.scale).toBe(1);
    expect(r.width).toBe(2048);
  });

  it("clamps to at least 1px on extreme aspect ratios", () => {
    const r = computeScaledDimensions(10000, 1, 2048);
    expect(r.width).toBe(2048);
    expect(r.height).toBe(1);
  });
});

describe("shouldSkipDownscale", () => {
  it("skips non-image files", () => {
    expect(shouldSkipDownscale(new File(["x"], "a.txt", { type: "text/plain" }))).toBe(true);
    expect(shouldSkipDownscale(new File(["x"], "a.mp4", { type: "video/mp4" }))).toBe(true);
  });

  it("skips GIFs (may be animated)", () => {
    expect(shouldSkipDownscale(new File(["x"], "a.gif", { type: "image/gif" }))).toBe(true);
  });

  it("processes ordinary photo formats", () => {
    expect(shouldSkipDownscale(new File(["x"], "a.jpg", { type: "image/jpeg" }))).toBe(false);
    expect(shouldSkipDownscale(new File(["x"], "a.png", { type: "image/png" }))).toBe(false);
    expect(shouldSkipDownscale(new File(["x"], "a.heic", { type: "image/heic" }))).toBe(false);
  });
});

describe("downscaleImage", () => {
  it("returns the original file untouched for skipped formats", async () => {
    const gif = new File(["x"], "a.gif", { type: "image/gif" });
    expect(await downscaleImage(gif)).toBe(gif);
    const vid = new File(["x"], "a.mp4", { type: "video/mp4" });
    expect(await downscaleImage(vid)).toBe(vid);
  });

  it("falls back to the original when no decoder is available", async () => {
    // In the node test environment there is no createImageBitmap / DOM canvas,
    // so decoding fails and the helper must return the original File, not throw.
    const jpg = new File(["not-really-an-image"], "a.jpg", { type: "image/jpeg" });
    expect(await downscaleImage(jpg)).toBe(jpg);
  });
});
