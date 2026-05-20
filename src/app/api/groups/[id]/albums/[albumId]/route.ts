import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getMemberRole, hasRole, isAtLeast, ROLE } from "@/lib/groupRoles";

// GET — album detail with all items (any member).
export async function GET(
  _request: Request,
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

  const album = await prisma.album.findUnique({
    where: { id: albumId },
    include: {
      createdBy: { select: { id: true, name: true, profileImageUrl: true } },
      items: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        include: { addedBy: { select: { id: true, name: true, profileImageUrl: true } } },
      },
    },
  });

  if (!album || album.groupId !== id) {
    return NextResponse.json({ error: "Album not found in this team" }, { status: 404 });
  }

  return NextResponse.json(album);
}

// PATCH — rename / change description / change cover. Album creator or
// CAPTAIN+ can edit.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; albumId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, albumId } = await params;
  const album = await prisma.album.findUnique({ where: { id: albumId } });
  if (!album || album.groupId !== id) {
    return NextResponse.json({ error: "Album not found in this team" }, { status: 404 });
  }

  const callerRole = await getMemberRole(id, session.user.id);
  if (callerRole === null) {
    return NextResponse.json({ error: "Not a member of this team" }, { status: 403 });
  }
  const isOwnAlbum = album.createdById === session.user.id;
  if (!isOwnAlbum && !isAtLeast(callerRole, ROLE.CAPTAIN)) {
    return NextResponse.json({ error: "Only the creator or a captain can edit this album" }, { status: 403 });
  }

  const { name, description, coverItemId } = await request.json();
  const data: { name?: string; description?: string; coverItemId?: string | null } = {};

  if (typeof name === "string") {
    const trimmed = name.trim();
    if (!trimmed) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    if (trimmed.length > 80) return NextResponse.json({ error: "name too long" }, { status: 400 });
    data.name = trimmed;
  }
  if (typeof description === "string") {
    data.description = description.trim().slice(0, 500);
  }
  if (coverItemId === null) {
    data.coverItemId = null;
  } else if (typeof coverItemId === "string") {
    const item = await prisma.albumItem.findUnique({ where: { id: coverItemId } });
    if (!item || item.albumId !== albumId) {
      return NextResponse.json({ error: "Cover item not in this album" }, { status: 400 });
    }
    data.coverItemId = coverItemId;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await prisma.album.update({ where: { id: albumId }, data });
  return NextResponse.json(updated);
}

// DELETE — album creator or CAPTAIN+ can remove. Cascade deletes items.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; albumId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, albumId } = await params;
  const album = await prisma.album.findUnique({ where: { id: albumId } });
  if (!album || album.groupId !== id) {
    return NextResponse.json({ error: "Album not found in this team" }, { status: 404 });
  }
  const callerRole = await getMemberRole(id, session.user.id);
  if (callerRole === null) {
    return NextResponse.json({ error: "Not a member of this team" }, { status: 403 });
  }
  const isOwnAlbum = album.createdById === session.user.id;
  if (!isOwnAlbum && !(await hasRole(id, session.user.id, ROLE.CAPTAIN))) {
    return NextResponse.json({ error: "Only the creator or a captain can delete this album" }, { status: 403 });
  }

  await prisma.album.delete({ where: { id: albumId } });
  return NextResponse.json({ success: true });
}
