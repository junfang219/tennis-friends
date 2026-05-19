import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { postEventSystemMessage } from "@/lib/eventGroup";
import { emitToUsers } from "@/lib/eventBus";

// POST /api/events/[id]/matches/[matchId]/dispute
// The non-reporting player rejects the reported score. Status reverts to
// "scheduled" so either player can re-report. The match stays linked to the
// event chat with a dispute notice so people can sort it out.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; matchId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: eventId, matchId } = await params;
  const userId = session.user.id;

  const match = await prisma.eventMatch.findUnique({ where: { id: matchId } });
  if (!match || match.eventId !== eventId) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }
  if (match.status !== "in_progress" || !match.score) {
    return NextResponse.json({ error: "No reported score to dispute" }, { status: 409 });
  }
  if (userId !== match.player1Id && userId !== match.player2Id) {
    return NextResponse.json({ error: "Only the players in this match can dispute" }, { status: 403 });
  }
  if (userId === match.reportedBy) {
    return NextResponse.json({ error: "You can't dispute your own report" }, { status: 409 });
  }

  const previousScore = match.score;
  await prisma.eventMatch.update({
    where: { id: matchId },
    data: {
      score: "",
      winnerSide: null,
      reportedBy: "",
      confirmedBy: "",
      disputedAt: new Date(),
      status: "scheduled",
    },
  });

  const disputer = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  const disputerName = disputer?.name ?? "A player";
  await postEventSystemMessage(
    eventId,
    `⚠️ ${disputerName} disputed the score (was ${previousScore}). Please re-enter together.`,
    userId
  );

  // Notify the original reporter that their score was challenged.
  await prisma.notification.create({
    data: {
      userId: match.reportedBy,
      actorId: userId,
      type: "event_match_disputed",
      eventId,
      matchId,
    },
  });
  emitToUsers([match.reportedBy], { kind: "notifications" });

  return NextResponse.json({ ok: true });
}
