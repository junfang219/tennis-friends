import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// GET all friend groups owned by the current user
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const friendGroups = await prisma.friendGroup.findMany({
    where: { ownerId: session.user.id },
    include: {
      members: {
        include: {
          user: { select: { id: true, name: true, profileImageUrl: true } },
        },
      },
      _count: { select: { members: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json(friendGroups);
}

// POST create a new friend group
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name, memberIds } = await request.json();

  if (!name?.trim()) {
    return NextResponse.json({ error: "Group name is required" }, { status: 400 });
  }

  const friendGroup = await prisma.friendGroup.create({
    data: {
      name: name.trim(),
      ownerId: session.user.id,
      members: {
        create: (memberIds || []).map((userId: string) => ({ userId })),
      },
    },
    include: {
      members: {
        include: {
          user: { select: { id: true, name: true, profileImageUrl: true } },
        },
      },
      _count: { select: { members: true } },
    },
  });

  return NextResponse.json(friendGroup);
}

// PUT update a friend group (name, add/remove members)
export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { friendGroupId, name, addMemberIds, removeMemberIds } = await request.json();

  const friendGroup = await prisma.friendGroup.findUnique({ where: { id: friendGroupId } });
  if (!friendGroup || friendGroup.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  if (name?.trim()) {
    await prisma.friendGroup.update({
      where: { id: friendGroupId },
      data: { name: name.trim() },
    });
  }

  if (addMemberIds?.length) {
    for (const userId of addMemberIds) {
      await prisma.friendGroupMember.upsert({
        where: { friendGroupId_userId: { friendGroupId, userId } },
        update: {},
        create: { friendGroupId, userId },
      });
    }
  }

  if (removeMemberIds?.length) {
    await prisma.friendGroupMember.deleteMany({
      where: {
        friendGroupId,
        userId: { in: removeMemberIds },
      },
    });
  }

  const updated = await prisma.friendGroup.findUnique({
    where: { id: friendGroupId },
    include: {
      members: {
        include: {
          user: { select: { id: true, name: true, profileImageUrl: true } },
        },
      },
      _count: { select: { members: true } },
    },
  });

  return NextResponse.json(updated);
}

// DELETE a friend group
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { friendGroupId } = await request.json();

  const friendGroup = await prisma.friendGroup.findUnique({ where: { id: friendGroupId } });
  if (!friendGroup || friendGroup.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  await prisma.friendGroup.delete({ where: { id: friendGroupId } });

  return NextResponse.json({ success: true });
}
