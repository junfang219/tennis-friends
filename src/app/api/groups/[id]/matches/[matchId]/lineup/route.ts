import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// PUT { userId, lineupSlot } — captain assigns a member's lineup slot for a match
export async function PUT(
  request: Request,
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
    return NextResponse.json({ error: "Only the team captain can assign lineups" }, { status: 403 });
  }

  const match = await prisma.teamMatch.findUnique({ where: { id: matchId } });
  if (!match || match.groupId !== id) {
    return NextResponse.json({ error: "Match not found in this team" }, { status: 404 });
  }

  const { userId, lineupSlot } = await request.json();
  if (!userId || typeof userId !== "string") {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }
  if (typeof lineupSlot !== "string" || lineupSlot.length > 24) {
    return NextResponse.json({ error: "lineupSlot must be a string up to 24 chars" }, { status: 400 });
  }

  // Target user must be a member of the team
  const targetMember = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: id, userId } },
  });
  if (!targetMember) {
    return NextResponse.json({ error: "Target user is not a member of this team" }, { status: 400 });
  }

  const slot = lineupSlot.trim();

  const upserted = await prisma.matchAvailability.upsert({
    where: { matchId_userId: { matchId, userId } },
    update: { lineupSlot: slot },
    create: { matchId, userId, status: "", matchTypes: "", lineupSlot: slot },
    include: {
      user: { select: { id: true, name: true, profileImageUrl: true } },
    },
  });

  return NextResponse.json(upserted);
}
