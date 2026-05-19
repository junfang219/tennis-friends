import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { postEventSystemMessage } from "@/lib/eventGroup";
import { emitToUsers } from "@/lib/eventBus";
import { advanceTournamentWinner } from "@/lib/tournamentAdvance";

// POST /api/events/[id]/matches/[matchId]/confirm
// The *other* player (the one who didn't report) confirms the score → match
// becomes "completed". Triggers tournament-bracket advance if applicable.
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
  if (match.status !== "in_progress" || !match.score || !match.winnerSide) {
    return NextResponse.json({ error: "No reported score to confirm" }, { status: 409 });
  }
  if (userId !== match.player1Id && userId !== match.player2Id) {
    return NextResponse.json({ error: "Only the players in this match can confirm" }, { status: 403 });
  }
  if (userId === match.reportedBy) {
    return NextResponse.json({ error: "The other player must confirm" }, { status: 409 });
  }

  await prisma.eventMatch.update({
    where: { id: matchId },
    data: {
      confirmedBy: userId,
      status: "completed",
      disputedAt: null,
    },
  });

  await postEventSystemMessage(eventId, `✅ Score confirmed: ${match.score}.`);

  // Notify the reporter so they see their submission was accepted.
  await prisma.notification.create({
    data: {
      userId: match.reportedBy,
      actorId: userId,
      type: "event_match_confirmed",
      eventId,
    },
  });
  emitToUsers([match.reportedBy], { kind: "notifications" });

  // Tournament bracket: pull the winner into the next round's open slot.
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { eventType: true },
  });
  if (event?.eventType === "tournament") {
    await advanceTournamentWinner(eventId, matchId);
  }

  return NextResponse.json({ ok: true });
}
