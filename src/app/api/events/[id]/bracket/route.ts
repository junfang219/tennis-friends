import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  bracketRoundLabel,
  bracketRounds,
  bracketSlot,
  seedBracket,
} from "@/lib/eventCompetitive";
import { postEventSystemMessage } from "@/lib/eventGroup";

// GET /api/events/[id]/bracket — assembles the bracket tree from EventMatch
// rows where bracketSlot is set. Auto-walks rounds 1..N.
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
  if (event.eventType !== "tournament") {
    return NextResponse.json({ error: "Not a tournament" }, { status: 400 });
  }

  const matches = await prisma.eventMatch.findMany({
    where: { eventId, bracketSlot: { not: "" } },
    orderBy: [{ round: "asc" }, { bracketSlot: "asc" }],
  });

  const playerIds = new Set<string>();
  for (const m of matches) {
    if (m.player1Id) playerIds.add(m.player1Id);
    if (m.player2Id) playerIds.add(m.player2Id);
  }
  const users =
    playerIds.size === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: [...playerIds] } },
          select: { id: true, name: true, profileImageUrl: true },
        });
  const userMap = new Map(users.map((u) => [u.id, u]));

  // Group by round for client rendering.
  const byRound = new Map<number, typeof matches>();
  for (const m of matches) {
    const r = m.round ?? 1;
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r)!.push(m);
  }

  // Total rounds = max round we know about; if no matches, 0.
  const totalRounds = matches.length > 0 ? Math.max(...matches.map((m) => m.round ?? 1)) : 0;

  return NextResponse.json({
    seeded: matches.length > 0,
    totalRounds,
    rounds: [...byRound.entries()]
      .sort(([a], [b]) => a - b)
      .map(([round, ms]) => ({
        round,
        label: bracketRoundLabel(round, totalRounds),
        matches: ms.map((m) => ({
          ...m,
          player1: m.player1Id ? userMap.get(m.player1Id) ?? null : null,
          player2: m.player2Id ? userMap.get(m.player2Id) ?? null : null,
        })),
      })),
  });
}

// POST /api/events/[id]/bracket — organizer seeds round 1 from currently
// registered participants. Refuses if matches already exist. Order of seeds is
// by signup time (earlier = higher seed) since we don't yet have a seeding UI.
export async function POST(
  _request: Request,
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
    select: { id: true, ownerId: true, eventType: true, title: true },
  });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (event.eventType !== "tournament") {
    return NextResponse.json({ error: "Not a tournament" }, { status: 400 });
  }
  if (event.ownerId !== userId) {
    return NextResponse.json({ error: "Only the organizer can seed" }, { status: 403 });
  }

  const existing = await prisma.eventMatch.count({ where: { eventId } });
  if (existing > 0) {
    return NextResponse.json({ error: "Bracket already seeded" }, { status: 409 });
  }

  const participants = await prisma.eventParticipant.findMany({
    where: { eventId, status: "registered" },
    orderBy: { registeredAt: "asc" },
    select: { userId: true },
  });
  if (participants.length < 2) {
    return NextResponse.json({ error: "Need at least 2 registered players" }, { status: 400 });
  }

  const pairs = seedBracket(participants.map((p) => p.userId));
  const totalRounds = bracketRounds(participants.length);

  // Create round 1 matches. Byes (one slot is null) become "completed" rows so
  // the advance logic immediately pulls the seeded player through.
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < pairs.length; i++) {
      const [a, b] = pairs[i];
      const slot = bracketSlot(1, i);
      if (a && b) {
        await tx.eventMatch.create({
          data: {
            eventId,
            player1Id: a,
            player2Id: b,
            round: 1,
            bracketSlot: slot,
            status: "scheduled",
          },
        });
      } else if (a || b) {
        // Bye — the present player advances immediately.
        const winnerSide = a ? 1 : 2;
        await tx.eventMatch.create({
          data: {
            eventId,
            player1Id: a ?? "",
            player2Id: b ?? "",
            round: 1,
            bracketSlot: slot,
            winnerSide,
            score: "BYE",
            status: "completed",
          },
        });
      }
    }
  });

  // Pull bye-winners into round 2 (the advance helper handles slot math).
  const byeMatches = await prisma.eventMatch.findMany({
    where: { eventId, round: 1, status: "completed" },
    select: { id: true },
  });
  const { advanceTournamentWinner } = await import("@/lib/tournamentAdvance");
  for (const m of byeMatches) {
    await advanceTournamentWinner(eventId, m.id);
  }

  await postEventSystemMessage(
    eventId,
    `🏆 Bracket seeded — ${participants.length} players, ${totalRounds} round${totalRounds === 1 ? "" : "s"}. Signups are now locked.`
  );

  return NextResponse.json({ seeded: true, totalRounds, matches: pairs.length });
}
