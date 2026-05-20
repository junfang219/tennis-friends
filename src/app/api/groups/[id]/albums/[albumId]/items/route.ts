import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getMemberRole } from "@/lib/groupRoles";

// POST — add one or more items to an album. Any member can add. Body shape:
//   { items: [{ url, mediaType, caption? }, ...] }
// URLs typically come from /api/upload but any same-origin path is fine.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; albumId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, albumId } = await params;
  if ((await getMemberRole(id, session.user.id)) === null) {
    return NextResponse.json({ error: "Not a member of this team" }, { status: 403 });
  }

  const album = await prisma.album.findUnique({ where: { id: albumId } });
  if (!album || album.groupId !== id) {
    return NextResponse.json({ error: "Album not found in this team" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const rawItems = (body && typeof body === "object" ? (body as { items?: unknown }).items : null) as unknown;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json({ error: "items array required" }, { status: 400 });
  }
  if (rawItems.length > 20) {
    return NextResponse.json({ error: "Up to 20 items per request" }, { status: 400 });
  }

  // Find the current max order so additions append.
  const last = await prisma.albumItem.findFirst({
    where: { albumId },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  let order = (last?.order ?? 0) + 1;

  const toCreate: { albumId: string; url: string; mediaType: string; caption: string; addedById: string; order: number }[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as { url?: unknown; mediaType?: unknown; caption?: unknown };
    if (typeof r.url !== "string" || !r.url.trim()) continue;
    const mediaType = r.mediaType === "video" ? "video" : "image";
    const caption = typeof r.caption === "string" ? r.caption.slice(0, 200) : "";
    toCreate.push({
      albumId,
      url: r.url.trim(),
      mediaType,
      caption,
      addedById: session.user.id,
      order: order++,
    });
  }
  if (toCreate.length === 0) {
    return NextResponse.json({ error: "No valid items" }, { status: 400 });
  }

  await prisma.albumItem.createMany({ data: toCreate });

  const created = await prisma.albumItem.findMany({
    where: { albumId, order: { gte: toCreate[0].order } },
    orderBy: { order: "asc" },
    include: { addedBy: { select: { id: true, name: true, profileImageUrl: true } } },
  });
  return NextResponse.json(created);
}
