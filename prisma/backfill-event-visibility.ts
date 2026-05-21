import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DEFAULT_RADIUS = 25;

async function main() {
  const events = await prisma.event.findMany({
    where: { eventLat: null },
    select: { id: true, ownerId: true },
  });

  if (events.length === 0) {
    console.log("No events need backfilling.");
    return;
  }

  console.log(`Found ${events.length} events without eventLat. Backfilling…`);

  let withCoords = 0;
  let withoutCoords = 0;

  for (const e of events) {
    const owner = await prisma.user.findUnique({
      where: { id: e.ownerId },
      select: { latitude: true, longitude: true },
    });
    if (owner?.latitude != null && owner?.longitude != null) {
      await prisma.event.update({
        where: { id: e.id },
        data: {
          visibility: "public",
          radiusMi: DEFAULT_RADIUS,
          eventLat: owner.latitude,
          eventLng: owner.longitude,
        },
      });
      withCoords += 1;
    } else {
      // Organizer has no location set. Leave eventLat=null; visibility filter
      // will hide it from everyone except participants/invitees/owner —
      // safer than a global-leak fallback.
      await prisma.event.update({
        where: { id: e.id },
        data: { visibility: "public", radiusMi: DEFAULT_RADIUS },
      });
      withoutCoords += 1;
    }
  }

  console.log(`Backfilled ${withCoords} with coords, ${withoutCoords} without.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
