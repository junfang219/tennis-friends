import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// Find-or-create the persistent chat for a friend group. Friend groups are
// private to their owner (FriendGroup.ownerId), so only the owner can call
// this. On subsequent calls we sync-add any new group members who aren't
// already participants — we never remove anyone, since that would orphan
// past messages.
export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await context.params;

  const friendGroup = await prisma.friendGroup.findUnique({
    where: { id },
    include: { members: { select: { userId: true } } },
  });
  if (!friendGroup) {
    return NextResponse.json({ error: "Friend group not found" }, { status: 404 });
  }
  if (friendGroup.ownerId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (friendGroup.members.length < 1) {
    return NextResponse.json({ error: "Friend group has no other members" }, { status: 400 });
  }

  const memberIds = friendGroup.members.map((m) => m.userId);

  const existing = await prisma.chat.findUnique({
    where: { friendGroupId: id },
    include: { participants: { select: { userId: true } } },
  });

  if (existing) {
    const existingIds = new Set(existing.participants.map((p) => p.userId));
    const missing = memberIds.filter((uid) => !existingIds.has(uid));
    if (missing.length > 0) {
      await prisma.chatParticipant.createMany({
        data: missing.map((uid) => ({ chatId: existing.id, userId: uid })),
      });
    }
    return NextResponse.json({ id: existing.id });
  }

  const chat = await prisma.chat.create({
    data: {
      name: friendGroup.name,
      creatorId: userId,
      friendGroupId: id,
      participants: {
        create: [
          { userId },
          ...memberIds.map((uid) => ({ userId: uid })),
        ],
      },
    },
    select: { id: true },
  });

  return NextResponse.json({ id: chat.id });
}
