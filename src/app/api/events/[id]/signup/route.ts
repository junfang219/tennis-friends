import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { syncEventGroupMembers } from "@/lib/eventGroup";

// POST /api/events/[id]/signup — join or claim a waitlist seat
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const userId = session.user.id;

  const event = await prisma.event.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      signupDeadline: true,
      maxParticipants: true,
      ntrpMin: true,
      ntrpMax: true,
      isPublicSignup: true,
      ownerId: true,
      eventType: true,
      _count: { select: { matches: true } },
    },
  });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (event.status === "cancelled" || event.status === "completed") {
    return NextResponse.json({ error: "Event is closed for signups" }, { status: 409 });
  }
  if (event.signupDeadline && event.signupDeadline < new Date()) {
    return NextResponse.json({ error: "Signup deadline has passed" }, { status: 409 });
  }
  // Tournaments lock signups once the bracket is seeded.
  if (event.eventType === "tournament" && event._count.matches > 0) {
    return NextResponse.json(
      { error: "Bracket is live — signups are locked" },
      { status: 409 }
    );
  }
  // Public signup gate; invite-only is a follow-up so we only allow the organizer for now.
  if (!event.isPublicSignup && userId !== event.ownerId) {
    return NextResponse.json({ error: "This event is invite-only" }, { status: 403 });
  }

  // NTRP gate.
  if (event.ntrpMin != null || event.ntrpMax != null) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { ntrpRating: true },
    });
    const rating = user?.ntrpRating;
    if (rating == null) {
      return NextResponse.json(
        { error: "Set your NTRP rating in your profile to sign up for this event" },
        { status: 400 }
      );
    }
    if (event.ntrpMin != null && rating < event.ntrpMin) {
      return NextResponse.json(
        { error: `NTRP ${event.ntrpMin}+ required for this event` },
        { status: 403 }
      );
    }
    if (event.ntrpMax != null && rating > event.ntrpMax) {
      return NextResponse.json(
        { error: `NTRP ${event.ntrpMax} max for this event` },
        { status: 403 }
      );
    }
  }

  // Decide registered vs waitlist based on current capacity.
  const registeredCount = await prisma.eventParticipant.count({
    where: { eventId: id, status: "registered" },
  });
  const willBeWaitlist =
    event.maxParticipants != null && registeredCount >= event.maxParticipants;
  const status = willBeWaitlist ? "waitlist" : "registered";

  // Upsert so re-signing up after a withdrawal works.
  await prisma.eventParticipant.upsert({
    where: { eventId_userId: { eventId: id, userId } },
    create: { eventId: id, userId, status },
    update: { status, registeredAt: new Date() },
  });

  if (status === "registered") {
    await syncEventGroupMembers(id);
  }

  // Notify the organizer (skip if the signer-upper *is* the organizer, which
  // shouldn't happen via this route since we auto-register on create, but
  // defensive guard is cheap).
  if (event.ownerId !== userId) {
    await prisma.notification.create({
      data: {
        userId: event.ownerId,
        actorId: userId,
        type: "event_signup",
        eventId: id,
      },
    });
  }

  return NextResponse.json({ status });
}

// DELETE /api/events/[id]/signup — withdraw
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const userId = session.user.id;

  const event = await prisma.event.findUnique({
    where: { id },
    select: { id: true, ownerId: true, maxParticipants: true },
  });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (event.ownerId === userId) {
    return NextResponse.json(
      { error: "Organizers can't withdraw — cancel the event instead" },
      { status: 409 }
    );
  }

  const existing = await prisma.eventParticipant.findUnique({
    where: { eventId_userId: { eventId: id, userId } },
  });
  if (!existing || existing.status === "withdrawn") {
    return NextResponse.json({ error: "You haven't signed up for this event" }, { status: 404 });
  }
  const wasRegistered = existing.status === "registered";

  await prisma.eventParticipant.update({
    where: { eventId_userId: { eventId: id, userId } },
    data: { status: "withdrawn" },
  });

  // Promote first waitlisted participant if a registered seat opened up.
  if (wasRegistered && event.maxParticipants != null) {
    const nextUp = await prisma.eventParticipant.findFirst({
      where: { eventId: id, status: "waitlist" },
      orderBy: { registeredAt: "asc" },
    });
    if (nextUp) {
      await prisma.eventParticipant.update({
        where: { id: nextUp.id },
        data: { status: "registered" },
      });
    }
  }

  await syncEventGroupMembers(id);
  return NextResponse.json({ success: true });
}
