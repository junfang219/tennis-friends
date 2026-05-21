import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const targetName = process.argv[2] ?? "Cloudy Fang";
  const url = process.argv[3] ?? "http://localhost:3000/api/events?filter=upcoming";

  const user = await prisma.user.findFirst({
    where: { name: targetName },
    select: { id: true, name: true },
  });
  if (!user) {
    console.error(`No user named "${targetName}"`);
    process.exit(1);
  }

  const session = await prisma.session.findFirst({
    where: { userId: user.id, expires: { gt: new Date() } },
    orderBy: { expires: "desc" },
  });
  if (!session) {
    console.error(`No active session for ${user.name} (${user.id}). They need to log in via the browser first.`);
    process.exit(1);
  }

  console.log(`Found session for ${user.name} (token: ${session.sessionToken.slice(0, 12)}…)`);
  console.log(`Hitting ${url}\n`);

  const res = await fetch(url, {
    headers: {
      cookie: `next-auth.session-token=${session.sessionToken}`,
    },
  });

  console.log(`Status: ${res.status}`);
  const body = await res.text();
  try {
    const json = JSON.parse(body);
    if (Array.isArray(json)) {
      console.log(`Got ${json.length} events:`);
      for (const e of json) {
        console.log(`  • [${e.id?.slice(0, 8) ?? "?"}] ${e.title} (vis=${e.visibility}, radius=${e.radiusMi}, distanceMi=${e.distanceMi})`);
      }
    } else {
      console.log(JSON.stringify(json, null, 2));
    }
  } catch {
    console.log("(non-JSON response)");
    console.log(body.slice(0, 500));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
