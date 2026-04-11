import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// GET list of users the current user has blocked
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const blocks = await prisma.block.findMany({
    where: { blockerId: session.user.id },
    include: {
      blocked: { select: { id: true, name: true, profileImageUrl: true, skillLevel: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    blocks.map((b) => ({
      id: b.id,
      createdAt: b.createdAt,
      user: b.blocked,
    }))
  );
}

// POST block a user — also removes any existing friendship between the two
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const { otherUserId } = await request.json();

  if (!otherUserId || typeof otherUserId !== "string") {
    return NextResponse.json({ error: "otherUserId required" }, { status: 400 });
  }
  if (otherUserId === userId) {
    return NextResponse.json({ error: "You cannot block yourself" }, { status: 400 });
  }

  // Upsert the block (idempotent)
  await prisma.block.upsert({
    where: { blockerId_blockedId: { blockerId: userId, blockedId: otherUserId } },
    update: {},
    create: { blockerId: userId, blockedId: otherUserId },
  });

  // Auto-remove any friendship (in either direction)
  await prisma.friendship.deleteMany({
    where: {
      OR: [
        { requesterId: userId, addresseeId: otherUserId },
        { requesterId: otherUserId, addresseeId: userId },
      ],
    },
  });

  return NextResponse.json({ success: true });
}

// DELETE unblock a user
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const { otherUserId } = await request.json();

  if (!otherUserId || typeof otherUserId !== "string") {
    return NextResponse.json({ error: "otherUserId required" }, { status: 400 });
  }

  await prisma.block.deleteMany({
    where: { blockerId: userId, blockedId: otherUserId },
  });

  return NextResponse.json({ success: true });
}
