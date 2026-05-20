import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getMemberRole, hasRole, ROLE } from "@/lib/groupRoles";

// GET — list all albums for the team (any member). Returns cover URL +
// item count for grid rendering.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if ((await getMemberRole(id, session.user.id)) === null) {
    return NextResponse.json({ error: "Not a member of this team" }, { status: 403 });
  }

  const albums = await prisma.album.findMany({
    where: { groupId: id },
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: { select: { id: true, name: true, profileImageUrl: true } },
      items: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        take: 1,
        select: { id: true, url: true, mediaType: true },
      },
      _count: { select: { items: true } },
    },
  });

  // Resolve explicit cover when set; otherwise fall back to first item.
  const result = await Promise.all(
    albums.map(async (a) => {
      let cover = a.items[0] || null;
      if (a.coverItemId) {
        const explicit = await prisma.albumItem.findUnique({
          where: { id: a.coverItemId },
          select: { id: true, url: true, mediaType: true },
        });
        if (explicit) cover = explicit;
      }
      return {
        id: a.id,
        name: a.name,
        description: a.description,
        createdAt: a.createdAt,
        createdBy: a.createdBy,
        itemCount: a._count.items,
        cover,
      };
    })
  );

  return NextResponse.json(result);
}

// POST — create an album. CAPTAIN+ so members can't spam empty albums.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!(await hasRole(id, session.user.id, ROLE.CAPTAIN))) {
    return NextResponse.json({ error: "Only a team captain can create albums" }, { status: 403 });
  }

  const { name, description } = await request.json();
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (name.length > 80) {
    return NextResponse.json({ error: "name must be 80 chars or fewer" }, { status: 400 });
  }

  const album = await prisma.album.create({
    data: {
      groupId: id,
      name: name.trim(),
      description: typeof description === "string" ? description.trim().slice(0, 500) : "",
      createdById: session.user.id,
    },
    include: {
      createdBy: { select: { id: true, name: true, profileImageUrl: true } },
    },
  });

  return NextResponse.json({
    id: album.id,
    name: album.name,
    description: album.description,
    createdAt: album.createdAt,
    createdBy: album.createdBy,
    itemCount: 0,
    cover: null,
  });
}
