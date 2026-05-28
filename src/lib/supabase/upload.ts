"use client";

import type { StorageBucket } from "./storage";
import { errorMessage } from "../errorMessage";

// Shared client-side upload helper. Mints a signed upload URL via our
// /api/storage/sign-upload route, PUTs the file to it, returns the
// resulting publicUrl + a best-effort media type ("image" or "video").
//
// Keeping this in one place stops every page from re-implementing the
// two-step dance.

export interface UploadResult {
  url: string;
  mediaType: "image" | "video" | "other";
}

export interface UploadError {
  message: string;
}

export async function uploadToBucket(
  file: File,
  bucket: StorageBucket
): Promise<UploadResult | UploadError> {
  const isVideo = file.type.startsWith("video/");
  const isImage = file.type.startsWith("image/");
  try {
    const sigRes = await fetch("/api/storage/sign-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket,
        filename: file.name,
        mimeType: file.type || (isVideo ? "video/mp4" : "image/jpeg"),
        sizeBytes: file.size,
      }),
    });
    if (!sigRes.ok) {
      const data = (await sigRes.json().catch(() => ({}))) as { error?: string };
      return { message: data.error || "Upload failed" };
    }
    const { signedUrl, publicUrl } = (await sigRes.json()) as {
      signedUrl: string;
      publicUrl: string;
    };
    const put = await fetch(signedUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!put.ok) return { message: "Upload failed" };
    return {
      url: publicUrl,
      mediaType: isVideo ? "video" : isImage ? "image" : "other",
    };
  } catch (err) {
    return { message: errorMessage(err, "Upload failed") };
  }
}

export function isUploadError(r: UploadResult | UploadError): r is UploadError {
  return "message" in r;
}
