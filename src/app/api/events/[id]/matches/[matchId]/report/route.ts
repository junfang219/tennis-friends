import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { parseScore, validateSinglesScore } from "@/lib/eventCompetitive";
import { postEventSystemMessage } from "@/lib/eventGroup";
import { emitToUsers } from "@/lib/eventBus";

// POST /api/events/[id]/matches/[matchId]/report
// Body: { score: "6-4,6-3" }
// Either player on the match can submit. Status moves to "in_progress" pending
// the other player's confirmation. Re-reporting is allowed (e.g. after dispute).
export async function POST(
  request: Request,
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
  if (match.status === "completed" || match.status === "cancelled") {
    return NextResponse.json({ error: "Match is closed" }, { status: 409 });
  }
  if (userId !== match.player1Id && userId !== match.player2Id) {
    return NextResponse.json({ error: "Only the players in this match can report" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const score = typeof body?.score === "string" ? body.score.trim() : "";
  const sets = parseScore(score);
  const valid = validateSinglesScore(sets);
  if (!valid.ok) {
    return NextResponse.json({ error: valid.error }, { status: 400 });
  }

  const updated = await prisma.eventMatch.update({
    where: { id: matchId },
    data: {
      score,
      winnerSide: valid.winnerSide,
      reportedBy: userId,
      confirmedBy: "",
      disputedAt: null,
      status: "in_progress",
    },
  });

  const otherId = userId === match.player1Id ? match.player2Id : match.player1Id;
  const [reporter, opponent] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: otherId }, select: { name: true } }),
  ]);
  const reporterName = reporter?.name ?? "A player";
  const opponentName = opponent?.name ?? "the other player";
  await postEventSystemMessage(
    eventId,
    `📝 ${reporterName} reported: ${score} — waiting for ${opponentName} to confirm.`,
    userId
  );

  // Notify the other player so they can confirm or dispute.
  await prisma.notification.create({
    data: {
      userId: otherId,
      actorId: userId,
      type: "event_match_report",
      eventId,
      matchId,
    },
  });
  emitToUsers([otherId], { kind: "notifications" });

  return NextResponse.json(updated);
}
