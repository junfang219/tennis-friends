import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
(async () => {
  const sessions = await prisma.session.findMany({
    include: { user: { select: { name: true } } },
    orderBy: { expires: "desc" },
    take: 10,
  });
  console.log(`${sessions.length} sessions:`);
  for (const s of sessions) {
    console.log(
      `  ${s.user.name.padEnd(20)} expires=${s.expires.toISOString()} token=${s.sessionToken.slice(0, 16)}…`
    );
  }
  await prisma.$disconnect();
})();
