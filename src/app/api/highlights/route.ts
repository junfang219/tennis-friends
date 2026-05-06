import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const ALLOWED_TYPES = new Set(["image", "video"]);

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const mediaUrl = typeof body.mediaUrl === "string" ? body.mediaUrl.trim() : "";
  const mediaType = typeof body.mediaType === "string" ? body.mediaType : "";
  const caption = typeof body.caption === "string" ? body.caption.trim().slice(0, 120) : "";

  if (!mediaUrl) {
    return NextResponse.json({ error: "mediaUrl required" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(mediaType)) {
    return NextResponse.json({ error: "mediaType must be image or video" }, { status: 400 });
  }

  const highlight = await prisma.highlight.create({
    data: {
      userId: session.user.id,
      mediaUrl,
      mediaType,
      caption,
    },
  });

  return NextResponse.json(highlight);
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const userId = (searchParams.get("userId") || session.user.id).trim();

  const highlights = await prisma.highlight.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(highlights);
}
