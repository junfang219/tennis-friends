import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { computeStandings, ladderMaxGap } from "@/lib/eventCompetitive";
import { postEventSystemMessage } from "@/lib/eventGroup";
import { emitToUsers } from "@/lib/eventBus";

// POST /api/events/[id]/challenges
// Body: { opponentId, scheduledAt?, courtAssign? }
// Ladder-only. The challenger picks someone up to N ranks above them. Creates
// an EventMatch row with status="proposed". Opponent receives a notification.
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
    select: { id: true, eventType: true, config: true, status: true },
  });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (event.eventType !== "ladder") {
    return NextResponse.json({ error: "Only ladder events accept challenges" }, { status: 400 });
  }
  if (event.status === "cancelled" || event.status === "completed") {
    return NextResponse.json({ error: "Event is closed" }, { status: 409 });
  }

  const body = await request.json().catch(() => null);
  const opponentId = typeof body?.opponentId === "string" ? body.opponentId : "";
  if (!opponentId || opponentId === userId) {
    return NextResponse.json({ error: "Pick a valid opponent" }, { status: 400 });
  }

  // Both must be registered.
  const participants = await prisma.eventParticipant.findMany({
    where: { eventId, status: "registered" },
    select: { userId: true },
  });
  const pSet = new Set(participants.map((p) => p.userId));
  if (!pSet.has(userId) || !pSet.has(opponentId)) {
    return NextResponse.json({ error: "Both players must be registered" }, { status: 400 });
  }

  // Rank-gap check.
  const completedMatches = await prisma.eventMatch.findMany({
    where: { eventId, status: "completed" },
  });
  const standings = computeStandings([...pSet], completedMatches);
  const myRank = standings.find((r) => r.userId === userId)?.rank;
  const oppRank = standings.find((r) => r.userId === opponentId)?.rank;
  if (myRank == null || oppRank == null) {
    return NextResponse.json({ error: "Rank not available" }, { status: 400 });
  }
  if (oppRank >= myRank) {
    return NextResponse.json(
      { error: "You can only challenge players ranked above you" },
      { status: 400 }
    );
  }
  const maxGap = ladderMaxGap(event.config);
  if (myRank - oppRank > maxGap) {
    return NextResponse.json(
      { error: `Challenge limited to ${maxGap} ranks above you` },
      { status: 400 }
    );
  }

  // Reject if there's already an open challenge between these two.
  const existing = await prisma.eventMatch.findFirst({
    where: {
      eventId,
      status: { in: ["proposed", "scheduled", "in_progress"] },
      OR: [
        { player1Id: userId, player2Id: opponentId },
        { player1Id: opponentId, player2Id: userId },
      ],
    },
  });
  if (existing) {
    return NextResponse.json(
      { error: "There's already an open match between you two" },
      { status: 409 }
    );
  }

  const match = await prisma.eventMatch.create({
    data: {
      eventId,
      player1Id: userId,
      player2Id: opponentId,
      proposedBy: userId,
      scheduledAt:
        typeof body?.scheduledAt === "string" && body.scheduledAt
          ? new Date(body.scheduledAt)
          : null,
      courtAssign: typeof body?.courtAssign === "string" ? body.courtAssign : "",
      status: "proposed",
    },
  });

  const challengerName = (
    await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
  )?.name;
  await postEventSystemMessage(
    eventId,
    `🪜 ${challengerName ?? "A player"} challenged a player up the ladder.`
  );

  await prisma.notification.create({
    data: {
      userId: opponentId,
      actorId: userId,
      type: "event_ladder_challenge",
      eventId,
    },
  });
  emitToUsers([opponentId], { kind: "notifications" });

  return NextResponse.json(match, { status: 201 });
}
