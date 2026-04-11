import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// DELETE a match (captain only)
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; matchId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, matchId } = await params;

  const group = await prisma.group.findUnique({ where: { id } });
  if (!group) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  if (group.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Only the team captain can delete matches" }, { status: 403 });
  }

  const match = await prisma.teamMatch.findUnique({ where: { id: matchId } });
  if (!match || match.groupId !== id) {
    return NextResponse.json({ error: "Match not found in this team" }, { status: 404 });
  }

  await prisma.teamMatch.delete({ where: { id: matchId } });

  return NextResponse.json({ success: true });
}
