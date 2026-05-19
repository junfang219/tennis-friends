import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getAcceptedFriendIds } from "@/lib/friendship";

// POST /api/events/[id]/invite — organizer sends event invites to selected friends
// Body: { userIds: string[] }
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
    select: { id: true, ownerId: true, status: true, title: true },
  });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (event.ownerId !== userId) {
    return NextResponse.json({ error: "Only the organizer can invite" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const userIds: unknown = body?.userIds;
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return NextResponse.json({ error: "userIds array required" }, { status: 400 });
  }
  const cleanIds = Array.from(
    new Set(userIds.filter((v): v is string => typeof v === "string" && v.length > 0 && v !== userId))
  );

  // Only friends — prevents spamming arbitrary users.
  const friendIds = await getAcceptedFriendIds(userId);
  const friendSet = new Set(friendIds);
  const allowed = cleanIds.filter((id) => friendSet.has(id));
  if (allowed.length === 0) {
    return NextResponse.json({ error: "Can only invite friends" }, { status: 403 });
  }

  // Skip users who already have a registration / waitlist / withdraw row — they
  // know about the event.
  const existing = await prisma.eventParticipant.findMany({
    where: { eventId, userId: { in: allowed } },
    select: { userId: true },
  });
  const known = new Set(existing.map((p) => p.userId));

  // Skip users we already invited recently (avoid duplicate notifications).
  const previouslyInvited = await prisma.notification.findMany({
    where: {
      type: "event_invite",
      eventId,
      actorId: userId,
      userId: { in: allowed },
    },
    select: { userId: true },
  });
  const alreadyInvited = new Set(previouslyInvited.map((n) => n.userId));

  const toNotify = allowed.filter((id) => !known.has(id) && !alreadyInvited.has(id));

  if (toNotify.length > 0) {
    await prisma.notification.createMany({
      data: toNotify.map((targetId) => ({
        userId: targetId,
        actorId: userId,
        type: "event_invite",
        eventId,
      })),
    });
  }

  return NextResponse.json({
    invited: toNotify.length,
    skippedKnown: allowed.length - toNotify.length - (allowed.length - cleanIds.length),
    requested: cleanIds.length,
  });
}
