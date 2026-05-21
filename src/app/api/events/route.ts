import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ensureEventGroup } from "@/lib/eventGroup";
import {
  applyPublicDistanceFilter,
  buildEventVisibilityWhere,
  isValidRadius,
  loadViewerContext,
} from "@/lib/events/visibility";

const VALID_EVENT_TYPES = new Set([
  "tournament",
  "round_robin",
  "ladder",
  "mixer",
  "clinic",
  "custom",
]);

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
  const baseFilters: Prisma.EventWhereInput[] = [];
  if (type && VALID_EVENT_TYPES.has(type)) baseFilters.push({ eventType: type });

  if (filter === "past") {
    baseFilters.push({ endDate: { lt: now } });
  } else if (filter === "joined") {
    baseFilters.push({
      participants: { some: { userId, status: { in: ["registered", "waitlist"] } } },
    });
  } else {
    // upcoming = currently open or running
    baseFilters.push({ endDate: { gte: now } });
    baseFilters.push({ status: { in: ["open", "closed", "active"] } });
  }

  // Apply visibility scope on top of the existing filters. `joined` is already
  // participant-scoped, but we still AND the visibility predicate so the OR
  // branches (participant/owner) trivially match — no extra cost.
  const ctx = await loadViewerContext(userId);
  const where: Prisma.EventWhereInput = {
    AND: [...baseFilters, buildEventVisibilityWhere(ctx)],
  };

  const rawEvents = await prisma.event.findMany({
    where,
    include: {
      owner: { select: { id: true, name: true, profileImageUrl: true } },
      participants: { select: { userId: true, status: true } },
      hostGroup: { select: { id: true, name: true } },
      _count: { select: { participants: { where: { status: "registered" } } } },
    },
    orderBy: [{ startDate: filter === "past" ? "desc" : "asc" }],
    take: 100,
  });

  // Tighten the public-branch bounding box with exact Haversine.
  const { kept, distanceById } = applyPublicDistanceFilter(rawEvents, ctx);

  const myStatusByEvent = new Map<string, string>();
  for (const e of kept) {
    const me = e.participants.find((p) => p.userId === userId);
    if (me) myStatusByEvent.set(e.id, me.status);
  }

  return NextResponse.json(
    kept.map((e) => {
      const { participants: _participants, _count, ...rest } = e;
      return {
        ...rest,
        myStatus: myStatusByEvent.get(e.id) ?? null,
        registeredCount: _count.participants,
        distanceMi: distanceById.has(e.id)
          ? Math.round(distanceById.get(e.id) as number)
          : null,
      };
    })
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
    visibility,
    eventLat,
    eventLng,
    radiusMi,
    hostGroupId,
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

  // Visibility — required choice; default to "public" for backward-compat clients.
  const vis = visibility === "group" ? "group" : "public";
  let resolvedLat: number | null = null;
  let resolvedLng: number | null = null;
  let resolvedRadius: number | null = null;
  let resolvedHostGroupId: string | null = null;

  if (vis === "public") {
    const lat = Number(eventLat);
    const lng = Number(eventLng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return NextResponse.json({ error: "Valid eventLat required for public events" }, { status: 400 });
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return NextResponse.json({ error: "Valid eventLng required for public events" }, { status: 400 });
    }
    if (!isValidRadius(radiusMi)) {
      return NextResponse.json({ error: "radiusMi must be 5, 10, 25, or 50" }, { status: 400 });
    }
    resolvedLat = lat;
    resolvedLng = lng;
    resolvedRadius = radiusMi as number;
  } else {
    if (typeof hostGroupId !== "string" || !hostGroupId) {
      return NextResponse.json({ error: "hostGroupId required for group events" }, { status: 400 });
    }
    if (postToFeed === true) {
      return NextResponse.json(
        { error: "Group events can't be cross-posted to the public feed" },
        { status: 400 }
      );
    }
    // Verify creator membership AND that the group isn't itself an event-
    // backing group (those are auto-created chat shells, not real clubs).
    const group = await prisma.group.findUnique({
      where: { id: hostGroupId },
      select: {
        event: { select: { id: true } },
        members: { where: { userId }, select: { id: true } },
      },
    });
    if (!group) {
      return NextResponse.json({ error: "Host group not found" }, { status: 404 });
    }
    if (group.event) {
      return NextResponse.json(
        { error: "Can't host an event in an event-backing group" },
        { status: 400 }
      );
    }
    if (group.members.length === 0) {
      return NextResponse.json(
        { error: "You must be a member of the host group" },
        { status: 403 }
      );
    }
    resolvedHostGroupId = hostGroupId;
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
      visibility: vis,
      eventLat: resolvedLat,
      eventLng: resolvedLng,
      radiusMi: resolvedRadius,
      hostGroupId: resolvedHostGroupId,
      // Organizer is not auto-registered as a player — they choose to sign up
      // (or not) like anyone else. The backing chat group still includes them
      // via ensureEventGroup so they can run the event without playing.
    },
  });

  await ensureEventGroup(event.id);

  // Cross-post to the public feed only for public events. Group events stay
  // inside their host group — cross-posting would leak them to the global feed.
  if (vis === "public" && postToFeed !== false) {
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
