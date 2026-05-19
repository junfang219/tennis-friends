import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ensureEventGroup } from "@/lib/eventGroup";

const VALID_EVENT_TYPES = new Set(["tournament", "round_robin", "mixer", "clinic", "custom"]);

// GET /api/events?filter=upcoming|past|joined&type=tournament
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { searchParams } = new URL(request.url);
  const filter = searchParams.get("filter") ?? "upcoming";
  const type = searchParams.get("type") ?? undefined;

  const now = new Date();
  const where: Record<string, unknown> = {};
  if (type && VALID_EVENT_TYPES.has(type)) where.eventType = type;

  if (filter === "past") {
    where.endDate = { lt: now };
  } else if (filter === "joined") {
    where.participants = { some: { userId, status: { in: ["registered", "waitlist"] } } };
  } else {
    // upcoming = currently open or running
    where.endDate = { gte: now };
    where.status = { in: ["open", "closed", "active"] };
  }

  const events = await prisma.event.findMany({
    where,
    include: {
      owner: { select: { id: true, name: true, profileImageUrl: true } },
      _count: { select: { participants: { where: { status: "registered" } } } },
    },
    orderBy: [{ startDate: filter === "past" ? "desc" : "asc" }],
    take: 100,
  });

  const myParticipations = await prisma.eventParticipant.findMany({
    where: { userId, eventId: { in: events.map((e) => e.id) } },
    select: { eventId: true, status: true },
  });
  const myStatusByEvent = new Map(myParticipations.map((p) => [p.eventId, p.status]));

  return NextResponse.json(
    events.map((e) => ({
      ...e,
      myStatus: myStatusByEvent.get(e.id) ?? null,
      registeredCount: e._count.participants,
    }))
  );
}

// POST /api/events — create event
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const {
    title,
    description,
    eventType,
    startDate,
    endDate,
    signupDeadline,
    isPublicSignup,
    maxParticipants,
    ntrpMin,
    ntrpMax,
    venueName,
    venueAddress,
    coverImageUrl,
    postToFeed,
  } = body;

  if (!title?.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (!VALID_EVENT_TYPES.has(eventType)) {
    return NextResponse.json({ error: "Invalid eventType" }, { status: 400 });
  }
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;
  if (!start || isNaN(start.getTime()) || !end || isNaN(end.getTime())) {
    return NextResponse.json({ error: "Valid startDate and endDate required" }, { status: 400 });
  }
  if (end < start) {
    return NextResponse.json({ error: "endDate must be on or after startDate" }, { status: 400 });
  }
  const deadline = signupDeadline ? new Date(signupDeadline) : null;
  if (deadline && (isNaN(deadline.getTime()) || deadline > start)) {
    return NextResponse.json({ error: "signupDeadline must be before startDate" }, { status: 400 });
  }
  if (typeof maxParticipants === "number" && maxParticipants <= 0) {
    return NextResponse.json({ error: "maxParticipants must be positive" }, { status: 400 });
  }
  if (
    typeof ntrpMin === "number" &&
    typeof ntrpMax === "number" &&
    ntrpMin > ntrpMax
  ) {
    return NextResponse.json({ error: "ntrpMin cannot exceed ntrpMax" }, { status: 400 });
  }

  const event = await prisma.event.create({
    data: {
      ownerId: userId,
      title: title.trim(),
      description: typeof description === "string" ? description : "",
      eventType,
      startDate: start,
      endDate: end,
      signupDeadline: deadline,
      isPublicSignup: isPublicSignup !== false,
      maxParticipants: typeof maxParticipants === "number" ? maxParticipants : null,
      ntrpMin: typeof ntrpMin === "number" ? ntrpMin : null,
      ntrpMax: typeof ntrpMax === "number" ? ntrpMax : null,
      venueName: typeof venueName === "string" ? venueName : "",
      venueAddress: typeof venueAddress === "string" ? venueAddress : "",
      coverImageUrl: typeof coverImageUrl === "string" ? coverImageUrl : "",
      // Auto-register the organizer.
      participants: { create: [{ userId, status: "registered" }] },
    },
  });

  await ensureEventGroup(event.id);

  // Auto cross-post to the feed for discovery, unless the organizer opted out.
  if (postToFeed !== false) {
    const teaser = (description || "").trim();
    await prisma.post.create({
      data: {
        authorId: userId,
        postType: "event",
        eventId: event.id,
        content: teaser,
      },
    });
  }

  return NextResponse.json(event, { status: 201 });
}
