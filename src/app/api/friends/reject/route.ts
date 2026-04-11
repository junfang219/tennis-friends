import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { friendshipId } = await request.json();

  const friendship = await prisma.friendship.findUnique({ where: { id: friendshipId } });

  if (!friendship || friendship.addresseeId !== session.user.id || friendship.status !== "PENDING") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  await prisma.friendship.delete({ where: { id: friendshipId } });

  // Clean up the original friend_request notification (don't notify the requester)
  await prisma.notification.deleteMany({
    where: {
      userId: session.user.id,
      actorId: friendship.requesterId,
      type: "friend_request",
    },
  });

  return NextResponse.json({ success: true });
}
