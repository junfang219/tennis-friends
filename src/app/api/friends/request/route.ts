import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { addresseeId } = await request.json();

  if (addresseeId === session.user.id) {
    return NextResponse.json({ error: "Cannot friend yourself" }, { status: 400 });
  }

  // Refuse if either side has blocked the other
  const block = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: session.user.id, blockedId: addresseeId },
        { blockerId: addresseeId, blockedId: session.user.id },
      ],
    },
  });
  if (block) {
    return NextResponse.json({ error: "You cannot send a friend request to this user" }, { status: 403 });
  }

  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: session.user.id, addresseeId },
        { requesterId: addresseeId, addresseeId: session.user.id },
      ],
    },
  });

  if (existing) {
    return NextResponse.json({ error: "Friendship already exists" }, { status: 400 });
  }

  const friendship = await prisma.friendship.create({
    data: { requesterId: session.user.id, addresseeId, status: "PENDING" },
  });

  // Notify the addressee that they have a new friend request
  await prisma.notification.create({
    data: {
      userId: addresseeId,
      actorId: session.user.id,
      type: "friend_request",
    },
  });

  return NextResponse.json(friendship);
}
