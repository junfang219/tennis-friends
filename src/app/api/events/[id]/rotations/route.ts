import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { mixerPairings } from "@/lib/eventCompetitive";
import { postEventSystemMessage } from "@/lib/eventGroup";

// POST /api/events/[id]/rotations
// Body: { round?: number }
// Mixer-only. Organizer triggers; auto-pairs currently checked-in players (or
// all registered if no one is checked in), creates EventMatch rows for round N,
// and posts a summary into the event chat. Deterministic per (eventId, round).
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
    select: { id: true, ownerId: true, eventType: true },
  });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (event.eventType !== "mixer") {
    return NextResponse.json({ error: "Rotations are only for mixers" }, { status: 400 });
  }
  if (event.ownerId !== userId) {
    return NextResponse.json({ error: "Only the organizer can post rotations" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  // Determine next round number: max existing round + 1, or 1.
  let round = typeof body?.round === "number" && body.round > 0 ? Math.floor(body.round) : 0;
  if (round === 0) {
    const latest = await prisma.eventMatch.findFirst({
      where: { eventId },
      orderBy: { round: "desc" },
      select: { round: true },
    });
    round = (latest?.round ?? 0) + 1;
  }

  // Reject if a round with this number already exists — keep it idempotent.
  const existingThisRound = await prisma.eventMatch.count({
    where: { eventId, round },
  });
  if (existingThisRound > 0) {
    return NextResponse.json({ error: `Round ${round} already exists` }, { status: 409 });
  }

  const participants = await prisma.eventParticipant.findMany({
    where: { eventId, status: "registered" },
    select: { userId: true, checkedInAt: true, user: { select: { name: true } } },
  });
  const checkedIn = participants.filter((p) => p.checkedInAt != null);
  const pool = checkedIn.length > 0 ? checkedIn : participants;
  if (pool.length < 2) {
    return NextResponse.json(
      { error: "Need at least 2 players to pair up" },
      { status: 400 }
    );
  }

  const nameByUserId = new Map(pool.map((p) => [p.userId, p.user.name]));
  const { pairs, bye } = mixerPairings(pool.map((p) => p.userId), eventId, round);

  await prisma.$transaction(
    pairs.map(([a, b]) =>
      prisma.eventMatch.create({
        data: {
          eventId,
          player1Id: a,
          player2Id: b,
          round,
          status: "scheduled",
        },
      })
    )
  );

  const summary = pairs
    .map(([a, b], i) => `Court ${i + 1}: ${nameByUserId.get(a)} vs ${nameByUserId.get(b)}`)
    .join("\n");
  const byeLine = bye ? `\nBye: ${nameByUserId.get(bye)}` : "";
  await postEventSystemMessage(
    eventId,
    `🤝 Round ${round} pairings:\n${summary}${byeLine}`
  );

  return NextResponse.json({ round, pairs: pairs.length, bye });
}
