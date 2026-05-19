import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { computeStandings } from "@/lib/eventCompetitive";

// GET /api/events/[id]/standings — derived from completed EventMatch rows.
// Always recomputed; we don't trust the cached fields on EventParticipant for
// the live view (those exist for future denormalized reads).
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
    select: { id: true },
  });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const [participants, matches] = await Promise.all([
    prisma.eventParticipant.findMany({
      where: { eventId, status: "registered" },
      include: {
        user: {
          select: { id: true, name: true, profileImageUrl: true, ntrpRating: true },
        },
      },
    }),
    prisma.eventMatch.findMany({
      where: { eventId, status: "completed" },
    }),
  ]);

  const rows = computeStandings(
    participants.map((p) => p.userId),
    matches
  );
  const userMap = new Map(participants.map((p) => [p.userId, p.user]));
  return NextResponse.json(
    rows.map((row) => ({
      ...row,
      user: userMap.get(row.userId) ?? null,
    }))
  );
}
