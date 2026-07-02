// Client-side image downscaling, run just before upload.
//
// Photos picked from a phone camera are commonly 3–12 MP JPEG/HEIC weighing
// several MB, but the feed never displays them wider than ~1080px. Storing the
// full-resolution original is pure waste: it inflates the storage bill and
// makes the first on-the-fly transform slower. So we cap the longest edge and
// re-encode (to WebP when the engine supports it, else JPEG) before the PUT.
//
// Everything here is best-effort. Any decode/encode failure — a HEIC the
// WebView can't paint to a canvas, a missing 2d context, an engine without
// createImageBitmap — falls back to the ORIGINAL File untouched, so a picky
// format never blocks a post. We also keep the original whenever re-encoding
// wouldn't actually make it smaller.

const DEFAULT_MAX_EDGE = 2048; // px — longest side after downscaling
const DEFAULT_QUALITY = 0.85; // WebP/JPEG encoder quality

export interface DownscaleOptions {
  maxEdge?: number;
  quality?: number;
}

// Formats we deliberately leave alone: GIFs may be animated (a canvas would
// flatten them to a single frame) and non-images obviously aren't ours to
// re-encode. Exported for testing.
export function shouldSkipDownscale(file: File): boolean {
  if (!file.type.startsWith("image/")) return true;
  if (file.type === "image/gif") return true;
  return false;
}

// Pure aspect-ratio math: scale the longer edge down to maxEdge, never upscale.
// Exported so the sizing logic can be unit-tested without a DOM.
export function computeScaledDimensions(
  width: number,
  height: number,
  maxEdge: number
): { width: number; height: number; scale: number } {
  const longest = Math.max(width, height);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

// Swap the filename extension so the stored object key matches the re-encoded
// content type (buildObjectKey derives the storage extension from the name).
function replaceExtension(name: string, mime: string): string {
  const ext = mime === "image/webp" ? "webp" : "jpg";
  const dot = name.lastIndexOf(".");
  const base = dot === -1 ? name : name.slice(0, dot);
  return `${base}.${ext}`;
}

interface Drawable {
  image: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function loadDrawable(file: File): Promise<Drawable | null> {
  // Prefer createImageBitmap: it honors EXIF orientation via `imageOrientation`
  // and decodes off the main thread.
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      } as ImageBitmapOptions);
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Fall through to the <img> path.
    }
  }
  if (typeof Image !== "function" || typeof URL?.createObjectURL !== "function") {
    return null;
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image decode failed"));
      el.src = url;
    });
    return {
      image: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

// Encode to WebP when the engine actually produces it (some fall back to PNG,
// which is huge for photos); otherwise JPEG.
async function encode(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<{ blob: Blob; type: string } | null> {
  const webp = await canvasToBlob(canvas, "image/webp", quality);
  if (webp && webp.type === "image/webp") return { blob: webp, type: "image/webp" };
  const jpeg = await canvasToBlob(canvas, "image/jpeg", quality);
  if (jpeg) return { blob: jpeg, type: "image/jpeg" };
  return null;
}

/**
 * Return a downscaled + re-encoded copy of an image File, or the original File
 * unchanged when downscaling is skipped, fails, or wouldn't reduce the size.
 * Never throws.
 */
export async function downscaleImage(
  file: File,
  opts: DownscaleOptions = {}
): Promise<File> {
  if (shouldSkipDownscale(file)) return file;
  const maxEdge = opts.maxEdge ?? DEFAULT_MAX_EDGE;
  const quality = opts.quality ?? DEFAULT_QUALITY;

  try {
    const source = await loadDrawable(file);
    if (!source) return file;
    try {
      const { width, height } = computeScaledDimensions(
        source.width,
        source.height,
        maxEdge
      );
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(source.image, 0, 0, width, height);

      const encoded = await encode(canvas, quality);
      // Keep the original if re-encoding didn't actually help (e.g. an already
      // tiny, well-compressed image).
      if (!encoded || encoded.blob.size >= file.size) return file;

      return new File([encoded.blob], replaceExtension(file.name, encoded.type), {
        type: encoded.type,
      });
    } finally {
      source.release();
    }
  } catch {
    return file;
  }
}
