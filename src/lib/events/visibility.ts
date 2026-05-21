import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { haversineMiles } from "@/lib/distance";

export const EVENT_RADII = [5, 10, 25, 50] as const;
export type EventRadius = (typeof EVENT_RADII)[number];
export const DEFAULT_EVENT_RADIUS: EventRadius = 25;
export const MAX_EVENT_RADIUS = 50;

export function isValidRadius(r: unknown): r is EventRadius {
  return typeof r === "number" && (EVENT_RADII as readonly number[]).includes(r);
}

async function fetchInvitedEventIds(viewerId: string): Promise<string[]> {
  const rows = await prisma.notification.findMany({
    where: { userId: viewerId, type: "event_invite" },
    select: { eventId: true },
  });
  return Array.from(new Set(rows.map((r) => r.eventId).filter((id): id is string => !!id)));
}

export type ViewerContext = {
  viewerId: string;
  viewerLat: number | null;
  viewerLng: number | null;
  invitedEventIds: string[];
};

export async function loadViewerContext(viewerId: string): Promise<ViewerContext> {
  const [me, invited] = await Promise.all([
    prisma.user.findUnique({
      where: { id: viewerId },
      select: { latitude: true, longitude: true },
    }),
    fetchInvitedEventIds(viewerId),
  ]);
  return {
    viewerId,
    viewerLat: me?.latitude ?? null,
    viewerLng: me?.longitude ?? null,
    invitedEventIds: invited,
  };
}

// Build the OR'd visibility predicate for /api/events listing.
// SQLite has no trig functions, so the public branch uses a lat/lng bounding
// box; callers should re-tighten via haversineMiles after fetch (see
// passesPublicDistance below) to drop bounding-box false positives.
export function buildEventVisibilityWhere(ctx: ViewerContext): Prisma.EventWhereInput {
  const branches: Prisma.EventWhereInput[] = [];

  if (ctx.viewerLat != null && ctx.viewerLng != null) {
    const latDelta = MAX_EVENT_RADIUS / 69;
    const cosLat = Math.cos((ctx.viewerLat * Math.PI) / 180);
    const lonDelta = MAX_EVENT_RADIUS / (69 * Math.max(0.01, cosLat));
    branches.push({
      visibility: "public",
      eventLat: { gte: ctx.viewerLat - latDelta, lte: ctx.viewerLat + latDelta },
      eventLng: { gte: ctx.viewerLng - lonDelta, lte: ctx.viewerLng + lonDelta },
    });
  }

  branches.push({
    visibility: "group",
    hostGroup: { is: { members: { some: { userId: ctx.viewerId } } } },
  });

  if (ctx.invitedEventIds.length > 0) {
    branches.push({ id: { in: ctx.invitedEventIds } });
  }

  branches.push({
    participants: {
      some: { userId: ctx.viewerId, status: { in: ["registered", "waitlist"] } },
    },
  });

  branches.push({ ownerId: ctx.viewerId });

  return { OR: branches };
}

// Apply exact Haversine to drop bounding-box false-positives for the public
// branch. Mirrors src/app/api/posts/route.ts:172-192. Returns the (possibly
// filtered) list plus a per-event distance map for the UI.
export function applyPublicDistanceFilter<
  E extends {
    id: string;
    visibility: string;
    eventLat: number | null;
    eventLng: number | null;
    radiusMi: number | null;
    ownerId: string;
    participants?: { userId: string; status: string }[];
    hostGroupId?: string | null;
  },
>(
  events: E[],
  ctx: ViewerContext
): { kept: E[]; distanceById: Map<string, number> } {
  const distanceById = new Map<string, number>();
  const kept = events.filter((e) => {
    // Non-public events bypass the distance check entirely — they passed
    // through one of the other OR branches (group / invited / participant / own).
    if (e.visibility !== "public") return true;

    // If the viewer falls into any non-distance branch, keep regardless of distance.
    if (e.ownerId === ctx.viewerId) return true;
    if (ctx.invitedEventIds.includes(e.id)) return true;
    if (
      e.participants?.some(
        (p) => p.userId === ctx.viewerId && (p.status === "registered" || p.status === "waitlist")
      )
    ) {
      return true;
    }

    // Public, no coords (legacy/backfill miss) → invisible to non-participants.
    if (ctx.viewerLat == null || ctx.viewerLng == null) return false;
    if (e.eventLat == null || e.eventLng == null || e.radiusMi == null) return false;

    const d = haversineMiles(ctx.viewerLat, ctx.viewerLng, e.eventLat, e.eventLng);
    if (d > e.radiusMi) return false;
    distanceById.set(e.id, d);
    return true;
  });
  return { kept, distanceById };
}

// IDs of all events the viewer can see. Used by the main feed to surface
// event cross-posts whose underlying event passes the visibility predicate
// (radius / group / invite / participant / owner) — independent of whether
// the post author is a friend.
export async function fetchVisibleEventIds(viewerId: string): Promise<string[]> {
  const ctx = await loadViewerContext(viewerId);
  const events = await prisma.event.findMany({
    where: buildEventVisibilityWhere(ctx),
    select: {
      id: true,
      visibility: true,
      eventLat: true,
      eventLng: true,
      radiusMi: true,
      ownerId: true,
      hostGroupId: true,
      participants: { select: { userId: true, status: true } },
    },
  });
  const { kept } = applyPublicDistanceFilter(events, ctx);
  return kept.map((e) => e.id);
}

// Single-event visibility check used by detail/signup/PATCH endpoints.
export async function userCanSeeEvent(
  event: {
    id: string;
    ownerId: string;
    visibility: string;
    eventLat: number | null;
    eventLng: number | null;
    radiusMi: number | null;
    hostGroupId: string | null;
  },
  viewerId: string
): Promise<boolean> {
  if (event.ownerId === viewerId) return true;

  const [participant, invited, viewer, member] = await Promise.all([
    prisma.eventParticipant.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: viewerId } },
      select: { status: true },
    }),
    prisma.notification.findFirst({
      where: { userId: viewerId, type: "event_invite", eventId: event.id },
      select: { id: true },
    }),
    event.visibility === "public"
      ? prisma.user.findUnique({
          where: { id: viewerId },
          select: { latitude: true, longitude: true },
        })
      : Promise.resolve(null),
    event.visibility === "group" && event.hostGroupId
      ? prisma.groupMember.findUnique({
          where: { groupId_userId: { groupId: event.hostGroupId, userId: viewerId } },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  if (participant && (participant.status === "registered" || participant.status === "waitlist")) {
    return true;
  }
  if (invited) return true;

  if (event.visibility === "group") return !!member;

  // visibility === "public"
  if (event.eventLat == null || event.eventLng == null || event.radiusMi == null) return false;
  if (!viewer || viewer.latitude == null || viewer.longitude == null) return false;
  const d = haversineMiles(viewer.latitude, viewer.longitude, event.eventLat, event.eventLng);
  return d <= event.radiusMi;
}
