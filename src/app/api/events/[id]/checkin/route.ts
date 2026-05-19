import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// POST /api/events/[id]/checkin
// Body: { userId, checkedIn: boolean }
// Organizer marks a participant checked in / out for the event day. Drives the
// mixer pairing pool and (optional) day-of organization.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: eventId } = await params;
  const callerId = session.user.id;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { ownerId: true },
  });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (event.ownerId !== callerId) {
    return NextResponse.json({ error: "Only the organizer can check participants in" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const checkedIn = !!body?.checkedIn;
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const participant = await prisma.eventParticipant.findUnique({
    where: { eventId_userId: { eventId, userId } },
  });
  if (!participant || participant.status !== "registered") {
    return NextResponse.json({ error: "Not a registered participant" }, { status: 400 });
  }

  await prisma.eventParticipant.update({
    where: { eventId_userId: { eventId, userId } },
    data: { checkedInAt: checkedIn ? new Date() : null },
  });

  return NextResponse.json({ ok: true, checkedIn });
}
