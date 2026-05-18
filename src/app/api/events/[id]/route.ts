import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// GET /api/events/[id] — full detail + roster
export async function GET(
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
    include: {
      owner: { select: { id: true, name: true, profileImageUrl: true } },
      participants: {
        include: {
          user: {
            select: { id: true, name: true, profileImageUrl: true, ntrpRating: true },
          },
        },
        orderBy: [{ status: "asc" }, { registeredAt: "asc" }],
      },
    },
  });

  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const me = event.participants.find((p) => p.userId === userId);
  return NextResponse.json({
    ...event,
    myStatus: me?.status ?? null,
    registeredCount: event.participants.filter((p) => p.status === "registered").length,
    waitlistCount: event.participants.filter((p) => p.status === "waitlist").length,
  });
}

// PATCH /api/events/[id] — organizer edits
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const userId = session.user.id;

  const event = await prisma.event.findUnique({ where: { id }, select: { ownerId: true } });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (event.ownerId !== userId) {
    return NextResponse.json({ error: "Only the organizer can edit" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim();
  if (typeof body.description === "string") data.description = body.description;
  if (typeof body.venueName === "string") data.venueName = body.venueName;
  if (typeof body.venueAddress === "string") data.venueAddress = body.venueAddress;
  if (typeof body.coverImageUrl === "string") data.coverImageUrl = body.coverImageUrl;
  if (typeof body.isPublicSignup === "boolean") data.isPublicSignup = body.isPublicSignup;
  if (body.maxParticipants === null || typeof body.maxParticipants === "number") {
    data.maxParticipants = body.maxParticipants;
  }
  if (body.ntrpMin === null || typeof body.ntrpMin === "number") data.ntrpMin = body.ntrpMin;
  if (body.ntrpMax === null || typeof body.ntrpMax === "number") data.ntrpMax = body.ntrpMax;
  if (typeof body.startDate === "string") {
    const d = new Date(body.startDate);
    if (!isNaN(d.getTime())) data.startDate = d;
  }
  if (typeof body.endDate === "string") {
    const d = new Date(body.endDate);
    if (!isNaN(d.getTime())) data.endDate = d;
  }
  if (body.signupDeadline === null) {
    data.signupDeadline = null;
  } else if (typeof body.signupDeadline === "string") {
    const d = new Date(body.signupDeadline);
    if (!isNaN(d.getTime())) data.signupDeadline = d;
  }
  if (
    typeof body.status === "string" &&
    ["open", "closed", "active", "completed", "cancelled"].includes(body.status)
  ) {
    data.status = body.status;
  }

  const updated = await prisma.event.update({ where: { id }, data });
  return NextResponse.json(updated);
}
