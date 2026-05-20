import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { writeFile } from "fs/promises";
import path from "path";

// Sibling to /api/upload (which handles images/videos). This route accepts
// document-style files for the team Files feature: PDFs, Word, Excel, plain
// text, etc. Returns { url, filename, mimeType, sizeBytes } so the caller
// can drop the result straight into the GroupFile create payload.

const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);

const ALLOWED_EXT_TO_MIME: Record<string, string> = {
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

const MAX_SIZE = 25 * 1024 * 1024; // 25MB

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Upload too large. Files must be under 25 MB." },
      { status: 413 }
    );
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const extType = ALLOWED_EXT_TO_MIME[ext] ?? "";
  const effectiveType = file.type || extType;

  if (!ALLOWED_MIME.has(effectiveType)) {
    return NextResponse.json(
      { error: "Supported formats: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, CSV" },
      { status: 400 }
    );
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File must be under 25 MB" }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  const stored = `${session.user.id}-${Date.now()}.${ext || "bin"}`;
  const uploadPath = path.join(process.cwd(), "public", "uploads", stored);
  await writeFile(uploadPath, buffer);

  return NextResponse.json({
    url: `/api/uploads/${stored}`,
    filename: file.name,
    mimeType: effectiveType,
    sizeBytes: file.size,
  });
}
