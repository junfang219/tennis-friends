import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { writeFile } from "fs/promises";
import path from "path";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime", "video/mov"];
const ALL_TYPES = [...IMAGE_TYPES, ...VIDEO_TYPES];

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const isImage = IMAGE_TYPES.includes(file.type);
  const isVideo = VIDEO_TYPES.includes(file.type);

  if (!ALL_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Supported formats: JPEG, PNG, GIF, WebP, MP4, WebM, MOV" },
      { status: 400 }
    );
  }

  const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
  if (file.size > maxSize) {
    return NextResponse.json(
      { error: `File must be under ${isVideo ? "100MB" : "10MB"}` },
      { status: 400 }
    );
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  const ext = file.name.split(".").pop()?.toLowerCase() || (isImage ? "jpg" : "mp4");
  const filename = `${session.user.id}-${Date.now()}.${ext}`;
  const uploadPath = path.join(process.cwd(), "public", "uploads", filename);

  await writeFile(uploadPath, buffer);

  const url = `/api/uploads/${filename}`;
  const mediaType = isImage ? "image" : isVideo ? "video" : "";

  return NextResponse.json({ url, mediaType });
}
