import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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

async function main() {
  const events = await prisma.event.findMany({
    select: {
      id: true,
      title: true,
      ownerId: true,
      visibility: true,
      eventLat: true,
      eventLng: true,
      radiusMi: true,
      hostGroupId: true,
      endDate: true,
      status: true,
      owner: { select: { name: true, latitude: true, longitude: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`\n=== ${events.length} events in DB ===\n`);
  for (const e of events) {
    console.log(`• [${e.id.slice(0, 8)}] "${e.title}"`);
    console.log(
      `    owner=${e.owner.name} | vis=${e.visibility} | radius=${e.radiusMi} | status=${e.status} | endDate=${e.endDate.toISOString().slice(0, 10)}`
    );
    console.log(`    eventLat=${e.eventLat} eventLng=${e.eventLng}`);
    console.log(`    hostGroupId=${e.hostGroupId ?? "(none)"}`);
  }

  const users = await prisma.user.findMany({
    select: { id: true, name: true, latitude: true, longitude: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  console.log(`\n=== Users (most recent 20) — location status ===\n`);
  for (const u of users) {
    const has = u.latitude != null && u.longitude != null;
    console.log(
      `  ${has ? "📍" : "  "} [${u.id.slice(0, 8)}] ${u.name}  lat=${u.latitude} lng=${u.longitude}`
    );
  }

  // For each public event with coords, show which users are inside its radius.
  console.log(`\n=== Distance matrix (public events vs users with location) ===\n`);
  for (const e of events) {
    if (e.visibility !== "public" || e.eventLat == null || e.eventLng == null || e.radiusMi == null) continue;
    console.log(`\n  "${e.title}" (radius=${e.radiusMi}mi @ ${e.eventLat.toFixed(4)},${e.eventLng.toFixed(4)}):`);
    for (const u of users) {
      if (u.latitude == null || u.longitude == null) continue;
      const d = haversineMiles(u.latitude, u.longitude, e.eventLat, e.eventLng);
      const inRadius = d <= e.radiusMi;
      console.log(
        `    ${inRadius ? "✓ IN " : "✗ OUT"}  ${u.name.padEnd(20)} ${d.toFixed(1)}mi away`
      );
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
