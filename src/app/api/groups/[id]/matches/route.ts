import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

async function verifyMembership(userId: string, groupId: string) {
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  return !!membership;
}

// GET all matches for a team (any member)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  if (!(await verifyMembership(session.user.id, id))) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const matches = await prisma.teamMatch.findMany({
    where: { groupId: id },
    orderBy: [{ matchDate: "asc" }, { matchTime: "asc" }],
    include: {
      availabilities: {
        include: {
          user: { select: { id: true, name: true, profileImageUrl: true } },
        },
      },
    },
  });

  return NextResponse.json(matches);
}

// POST create a new match (captain only)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const group = await prisma.group.findUnique({ where: { id } });
  if (!group) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  if (group.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Only the team captain can add matches" }, { status: 403 });
  }

  const { matchDate, matchTime, location, notes } = await request.json();

  if (!matchDate || typeof matchDate !== "string") {
    return NextResponse.json({ error: "matchDate is required" }, { status: 400 });
  }
  if (!location || typeof location !== "string" || !location.trim()) {
    return NextResponse.json({ error: "location is required" }, { status: 400 });
  }

  const match = await prisma.teamMatch.create({
    data: {
      groupId: id,
      matchDate,
      matchTime: typeof matchTime === "string" ? matchTime : "",
      location: location.trim(),
      notes: typeof notes === "string" ? notes.trim() : "",
    },
    include: {
      availabilities: {
        include: {
          user: { select: { id: true, name: true, profileImageUrl: true } },
        },
      },
    },
  });

  return NextResponse.json(match);
}
