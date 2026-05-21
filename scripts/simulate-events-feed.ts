import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const MAX_EVENT_RADIUS = 50;

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

async function loadCtx(userId: string) {
  const [me, invited] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { latitude: true, longitude: true } }),
    prisma.notification.findMany({
      where: { userId, type: "event_invite" },
      select: { eventId: true },
    }),
  ]);
  return {
    viewerId: userId,
    viewerLat: me?.latitude ?? null,
    viewerLng: me?.longitude ?? null,
    invitedEventIds: Array.from(new Set(invited.map((r) => r.eventId).filter(Boolean))),
  };
}

function buildWhere(ctx: Awaited<ReturnType<typeof loadCtx>>): Prisma.EventWhereInput {
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
  if (ctx.invitedEventIds.length > 0) branches.push({ id: { in: ctx.invitedEventIds } });
  branches.push({
    participants: { some: { userId: ctx.viewerId, status: { in: ["registered", "waitlist"] } } },
  });
  branches.push({ ownerId: ctx.viewerId });
  return { OR: branches };
}

async function simulateFor(userId: string, name: string) {
  const ctx = await loadCtx(userId);
  const now = new Date();
  const where: Prisma.EventWhereInput = {
    AND: [
      { endDate: { gte: now } },
      { status: { in: ["open", "closed", "active"] } },
      buildWhere(ctx),
    ],
  };
  const raw = await prisma.event.findMany({
    where,
    include: { participants: { select: { userId: true, status: true } } },
    take: 100,
  });
  const kept = raw.filter((e) => {
    if (e.visibility !== "public") return true;
    if (e.ownerId === ctx.viewerId) return true;
    if (ctx.invitedEventIds.includes(e.id)) return true;
    if (
      e.participants.some(
        (p) => p.userId === ctx.viewerId && (p.status === "registered" || p.status === "waitlist")
      )
    ) {
      return true;
    }
    if (ctx.viewerLat == null || ctx.viewerLng == null) return false;
    if (e.eventLat == null || e.eventLng == null || e.radiusMi == null) return false;
    return haversineMiles(ctx.viewerLat, ctx.viewerLng, e.eventLat, e.eventLng) <= e.radiusMi;
  });
  console.log(
    `\n[${name.padEnd(20)}] lat=${ctx.viewerLat ?? "null"} lng=${ctx.viewerLng ?? "null"}`
  );
  console.log(`  prisma returned ${raw.length}, kept ${kept.length}:`);
  if (kept.length === 0) console.log("    (none)");
  for (const e of kept) console.log(`    ✓ ${e.title}`);
}

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  console.log(`Simulating GET /api/events for ${users.length} recent users…`);
  for (const u of users) await simulateFor(u.id, u.name);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
