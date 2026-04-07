import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// GET all groups the user owns or is a member of
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const groups = await prisma.group.findMany({
    where: {
      OR: [
        { ownerId: session.user.id },
        { members: { some: { userId: session.user.id } } },
      ],
    },
    include: {
      owner: { select: { id: true, name: true, profileImageUrl: true } },
      members: {
        include: {
          user: { select: { id: true, name: true, profileImageUrl: true } },
        },
      },
      _count: { select: { members: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json(groups);
}

// POST create a new group
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name, memberIds } = await request.json();

  if (!name?.trim()) {
    return NextResponse.json({ error: "Group name is required" }, { status: 400 });
  }

  const group = await prisma.group.create({
    data: {
      name: name.trim(),
      ownerId: session.user.id,
      members: {
        create: [
          // Owner is also a member
          { userId: session.user.id },
          // Add selected friends
          ...(memberIds || [])
            .filter((id: string) => id !== session.user!.id)
            .map((userId: string) => ({ userId })),
        ],
      },
    },
    include: {
      owner: { select: { id: true, name: true, profileImageUrl: true } },
      members: {
        include: {
          user: { select: { id: true, name: true, profileImageUrl: true } },
        },
      },
      _count: { select: { members: true } },
    },
  });

  return NextResponse.json(group);
}

// PUT update a group (name, add/remove members)
export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { groupId, name, addMemberIds, removeMemberIds } = await request.json();

  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group || group.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Update name if provided
  if (name?.trim()) {
    await prisma.group.update({
      where: { id: groupId },
      data: { name: name.trim() },
    });
  }

  // Add members
  if (addMemberIds?.length) {
    for (const userId of addMemberIds) {
      await prisma.groupMember.upsert({
        where: { groupId_userId: { groupId, userId } },
        update: {},
        create: { groupId, userId },
      });
    }
  }

  // Remove members (can't remove owner)
  if (removeMemberIds?.length) {
    await prisma.groupMember.deleteMany({
      where: {
        groupId,
        userId: { in: removeMemberIds.filter((id: string) => id !== group.ownerId) },
      },
    });
  }

  const updated = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      owner: { select: { id: true, name: true, profileImageUrl: true } },
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

// DELETE a group
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { groupId } = await request.json();

  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group || group.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  await prisma.group.delete({ where: { id: groupId } });

  return NextResponse.json({ success: true });
}
