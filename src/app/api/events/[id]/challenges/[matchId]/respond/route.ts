import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { postEventSystemMessage } from "@/lib/eventGroup";
import { emitToUsers } from "@/lib/eventBus";

// POST /api/events/[id]/challenges/[matchId]/respond
// Body: { accept: boolean, scheduledAt?, courtAssign? }
// The opponent (player2 on the proposed match) either accepts (→ "scheduled")
// or declines (→ "declined"). The challenger is notified.
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
  if (match.status !== "proposed") {
    return NextResponse.json({ error: "Challenge isn't pending" }, { status: 409 });
  }
  if (userId !== match.player2Id) {
    return NextResponse.json({ error: "Only the challenged player can respond" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const accept = !!body?.accept;

  const [responder, challenger] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: match.proposedBy }, select: { name: true } }),
  ]);
  const responderName = responder?.name ?? "A player";
  const challengerName = challenger?.name ?? "the challenger";

  if (accept) {
    await prisma.eventMatch.update({
      where: { id: matchId },
      data: {
        status: "scheduled",
        scheduledAt:
          typeof body?.scheduledAt === "string" && body.scheduledAt
            ? new Date(body.scheduledAt)
            : match.scheduledAt,
        courtAssign:
          typeof body?.courtAssign === "string" ? body.courtAssign : match.courtAssign,
      },
    });
    await postEventSystemMessage(
      eventId,
      `🪜 ${responderName} accepted ${challengerName}'s challenge — match scheduled.`,
      userId
    );
  } else {
    await prisma.eventMatch.update({
      where: { id: matchId },
      data: { status: "declined" },
    });
    await postEventSystemMessage(
      eventId,
      `🪜 ${responderName} declined ${challengerName}'s challenge.`,
      userId
    );
  }

  await prisma.notification.create({
    data: {
      userId: match.proposedBy,
      actorId: userId,
      type: accept ? "event_challenge_accepted" : "event_challenge_declined",
      eventId,
      matchId,
    },
  });
  emitToUsers([match.proposedBy], { kind: "notifications" });

  return NextResponse.json({ accepted: accept });
}
