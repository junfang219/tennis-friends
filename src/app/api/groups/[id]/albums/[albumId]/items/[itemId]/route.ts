import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getMemberRole, hasRole, ROLE } from "@/lib/groupRoles";

// DELETE — remove an item. Allowed for the user who added it OR CAPTAIN+.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; albumId: string; itemId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, albumId, itemId } = await params;

  if ((await getMemberRole(id, session.user.id)) === null) {
    return NextResponse.json({ error: "Not a member of this team" }, { status: 403 });
  }

  const item = await prisma.albumItem.findUnique({
    where: { id: itemId },
    include: { album: { select: { groupId: true } } },
  });
  if (!item || item.albumId !== albumId || item.album.groupId !== id) {
    return NextResponse.json({ error: "Item not found in this album" }, { status: 404 });
  }

  const isOwn = item.addedById === session.user.id;
  if (!isOwn && !(await hasRole(id, session.user.id, ROLE.CAPTAIN))) {
    return NextResponse.json({ error: "Only the uploader or a captain can remove this item" }, { status: 403 });
  }

  await prisma.albumItem.delete({ where: { id: itemId } });

  // If this item was the album's explicit cover, clear it so list pages
  // fall back to the next item.
  await prisma.album.updateMany({
    where: { id: albumId, coverItemId: itemId },
    data: { coverItemId: null },
  });

  return NextResponse.json({ success: true });
}
