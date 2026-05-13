import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// Turning off location sharing: null out the user's coordinates and disable
// any of their active broadcast posts (broadcasts require the author's lat/lng
// on the server, so they'd otherwise become orphaned).
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  const [, broadcasts] = await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { latitude: null, longitude: null },
    }),
    prisma.post.updateMany({
      where: { authorId: userId, isBroadcast: true, isComplete: false },
      data: {
        isBroadcast: false,
        broadcastLat: null,
        broadcastLng: null,
        broadcastRadiusMi: 0,
      },
    }),
  ]);

  return NextResponse.json({ ok: true, disabledBroadcasts: broadcasts.count });
}
