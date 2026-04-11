import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const ALLOWED_STATUS = ["available", "if_needed", "not_available", "not_sure"];
const ALLOWED_TYPES = ["singles", "doubles", "both", ""];

// PUT upsert the current user's availability for a match
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; matchId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, matchId } = await params;
  const userId = session.user.id;

  // Must be a member of the team
  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: id, userId } },
  });
  if (!member) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  // Match must belong to this team
  const match = await prisma.teamMatch.findUnique({ where: { id: matchId } });
  if (!match || match.groupId !== id) {
    return NextResponse.json({ error: "Match not found in this team" }, { status: 404 });
  }

  const { status, matchTypes } = await request.json();
  if (typeof status !== "string" || !ALLOWED_STATUS.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  const types = typeof matchTypes === "string" ? matchTypes : "";
  if (!ALLOWED_TYPES.includes(types)) {
    return NextResponse.json({ error: "Invalid matchTypes" }, { status: 400 });
  }

  const upserted = await prisma.matchAvailability.upsert({
    where: { matchId_userId: { matchId, userId } },
    update: { status, matchTypes: types },
    create: { matchId, userId, status, matchTypes: types },
    include: {
      user: { select: { id: true, name: true, profileImageUrl: true } },
    },
  });

  return NextResponse.json(upserted);
}
