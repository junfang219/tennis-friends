import { NextResponse } from "next/server";
import { open, stat } from "fs/promises";
import path from "path";

const MIME_TYPES: Record<string, string> = {
  // Inline-rendered (album lightbox, chat thumbnails, post photos).
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  // Documents (Files feature). These get Content-Disposition: attachment
  // below so the iOS WebView triggers a save/share sheet rather than
  // rendering them in-place with no close affordance.
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  csv: "text/csv",
};

// Anything not in this set is served with attachment disposition.
const INLINE_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "video/mp4", "video/webm", "video/quicktime",
]);

// RFC 5987 + RFC 6266 — encode the filename for the Content-Disposition
// header. ASCII fallback in `filename=` plus UTF-8 `filename*=` for
// non-ASCII names (so "résumé.pdf" arrives intact).
function dispositionHeader(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  const utf8 = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

// Read a byte range from a file as a Uint8Array (compatible with both
// Buffer and Web Streams response bodies).
async function readRange(filePath: string, start: number, end: number): Promise<Uint8Array> {
  const fh = await open(filePath, "r");
  try {
    const length = end - start + 1;
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, start);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } finally {
    await fh.close();
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  // Sanitize filename — only allow alphanumeric, dash, dot, underscore
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const filePath = path.join(process.cwd(), "public", "uploads", filename);
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  // Force download for non-image/video types. Caller may override the
  // filename via ?name= (the Files page passes the original upload name).
  const url = new URL(request.url);
  const downloadName = url.searchParams.get("name");
  const isInline = INLINE_TYPES.has(contentType);
  const dispositionExtras: Record<string, string> = isInline
    ? {}
    : { "Content-Disposition": dispositionHeader(downloadName || filename) };

  let fileSize: number;
  try {
    const s = await stat(filePath);
    fileSize = s.size;
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const rangeHeader = request.headers.get("range");

  // No Range header — return the full file but advertise Accept-Ranges so
  // the browser issues a Range request next time (videos seeking/streaming).
  if (!rangeHeader) {
    const data = await readRange(filePath, 0, fileSize - 1);
    return new NextResponse(data as BodyInit, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileSize),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000, immutable",
        ...dispositionExtras,
      },
    });
  }

  // Range: bytes=START-END (END optional)
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) {
    return new NextResponse(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${fileSize}` },
    });
  }
  const startStr = match[1];
  const endStr = match[2];
  const start = startStr ? parseInt(startStr, 10) : 0;
  let end = endStr ? parseInt(endStr, 10) : fileSize - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= fileSize) {
    return new NextResponse(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${fileSize}` },
    });
  }
  // Cap each chunk so a misbehaving client can't ask for a 100 MB chunk.
  const MAX_CHUNK = 4 * 1024 * 1024; // 4 MB per range request
  if (end - start + 1 > MAX_CHUNK) end = start + MAX_CHUNK - 1;

  const data = await readRange(filePath, start, end);
  return new NextResponse(data as BodyInit, {
    status: 206,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
      ...dispositionExtras,
    },
  });
}
