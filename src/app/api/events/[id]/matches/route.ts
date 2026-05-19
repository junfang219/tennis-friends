import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// GET /api/events/[id]/matches — public to authed users; lists all matches with
// resolved player profiles. Used by MatchList, BracketView, RotationCard.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: eventId } = await params;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, eventType: true },
  });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const matches = await prisma.eventMatch.findMany({
    where: { eventId },
    orderBy: [{ round: "asc" }, { createdAt: "asc" }],
  });

  const playerIds = new Set<string>();
  for (const m of matches) {
    if (m.player1Id) playerIds.add(m.player1Id);
    if (m.player2Id) playerIds.add(m.player2Id);
    if (m.player3Id) playerIds.add(m.player3Id);
    if (m.player4Id) playerIds.add(m.player4Id);
  }
  const users =
    playerIds.size === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: [...playerIds] } },
          select: { id: true, name: true, profileImageUrl: true, ntrpRating: true },
        });
  const userMap = new Map(users.map((u) => [u.id, u]));

  return NextResponse.json(
    matches.map((m) => ({
      ...m,
      player1: userMap.get(m.player1Id) ?? null,
      player2: userMap.get(m.player2Id) ?? null,
      player3: m.player3Id ? userMap.get(m.player3Id) ?? null : null,
      player4: m.player4Id ? userMap.get(m.player4Id) ?? null : null,
    }))
  );
}

// POST /api/events/[id]/matches — organizer-only manual match creation.
// Body: { player1Id, player2Id, round?, scheduledAt?, courtAssign? }.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: eventId } = await params;
  const userId = session.user.id;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, ownerId: true },
  });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (event.ownerId !== userId) {
    return NextResponse.json({ error: "Only the organizer can create matches" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const player1Id = typeof body.player1Id === "string" ? body.player1Id : "";
  const player2Id = typeof body.player2Id === "string" ? body.player2Id : "";
  if (!player1Id || !player2Id || player1Id === player2Id) {
    return NextResponse.json({ error: "Two distinct players required" }, { status: 400 });
  }

  // Both must be registered participants.
  const participants = await prisma.eventParticipant.findMany({
    where: { eventId, userId: { in: [player1Id, player2Id] }, status: "registered" },
    select: { userId: true },
  });
  if (participants.length !== 2) {
    return NextResponse.json(
      { error: "Both players must be registered for the event" },
      { status: 400 }
    );
  }

  const data = {
    eventId,
    player1Id,
    player2Id,
    round: typeof body.round === "number" ? body.round : null,
    scheduledAt:
      typeof body.scheduledAt === "string" && body.scheduledAt
        ? new Date(body.scheduledAt)
        : null,
    courtAssign: typeof body.courtAssign === "string" ? body.courtAssign : "",
    status: "scheduled",
  };

  const match = await prisma.eventMatch.create({ data });
  return NextResponse.json(match, { status: 201 });
}
