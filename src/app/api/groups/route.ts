import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// GET all teams the user is a member of, optionally filtered by archive state
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const archived = searchParams.get("archived") === "true";

  // Per-user archive state lives on GroupMember.archivedAt — query through it
  // to honor the filter. Note: a team owner is also a GroupMember row, so this
  // single query handles both owner and non-owner cases uniformly.
  const memberships = await prisma.groupMember.findMany({
    where: {
      userId: session.user.id,
      ...(archived ? { archivedAt: { not: null } } : { archivedAt: null }),
    },
    select: { groupId: true },
  });
  const groupIds = memberships.map((m) => m.groupId);

  if (groupIds.length === 0) {
    return NextResponse.json([]);
  }

  const groups = await prisma.group.findMany({
    where: { id: { in: groupIds } },
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

// PATCH archive / unarchive a team for the current user only
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { groupId, action } = await request.json();
  if (!groupId || (action !== "archive" && action !== "unarchive")) {
    return NextResponse.json(
      { error: "groupId and action ('archive' | 'unarchive') required" },
      { status: 400 }
    );
  }

  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: session.user.id } },
  });
  if (!member) {
    return NextResponse.json({ error: "Not a member of this team" }, { status: 403 });
  }

  await prisma.groupMember.update({
    where: { groupId_userId: { groupId, userId: session.user.id } },
    data: { archivedAt: action === "archive" ? new Date() : null },
  });

  return NextResponse.json({ success: true });
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

  // Auto-post a welcome message in the team chat from the captain
  await prisma.groupMessage.create({
    data: {
      groupId: group.id,
      senderId: session.user.id,
      content: `Welcome to ${group.name}! 🎾🏆 Let's have some great matches together! 💪`,
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

  const userId = session.user.id;
  const { groupId, name, addMemberIds, removeMemberIds } = await request.json();

  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const isOwner = group.ownerId === userId;

  // Non-owners must be members to do anything
  if (!isOwner) {
    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this team" }, { status: 403 });
    }
  }

  // Only the owner can rename the team
  if (name?.trim()) {
    if (!isOwner) {
      return NextResponse.json({ error: "Only the team creator can rename the team" }, { status: 403 });
    }
    await prisma.group.update({
      where: { id: groupId },
      data: { name: name.trim() },
    });
  }

  // Only the owner can remove members
  if (removeMemberIds?.length) {
    if (!isOwner) {
      return NextResponse.json({ error: "Only the team creator can remove members" }, { status: 403 });
    }
    await prisma.groupMember.deleteMany({
      where: {
        groupId,
        userId: { in: removeMemberIds.filter((id: string) => id !== group.ownerId) },
      },
    });
  }

  // Add members — owner can add anyone, non-owners can only add their own friends
  if (addMemberIds?.length) {
    let toAdd = addMemberIds.filter((id: string) => id && id !== userId);

    if (!isOwner) {
      // Validate that every added user is an accepted friend of the caller
      const friendships = await prisma.friendship.findMany({
        where: {
          status: "ACCEPTED",
          OR: [
            { requesterId: userId, addresseeId: { in: toAdd } },
            { addresseeId: userId, requesterId: { in: toAdd } },
          ],
        },
      });
      const friendIds = new Set(
        friendships.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId))
      );
      const invalid = (toAdd as string[]).filter((id) => !friendIds.has(id));
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: "You can only add your own friends to the team" },
          { status: 403 }
        );
      }
      toAdd = toAdd as string[];
    }

    for (const memberId of toAdd as string[]) {
      await prisma.groupMember.upsert({
        where: { groupId_userId: { groupId, userId: memberId } },
        update: {},
        create: { groupId, userId: memberId },
      });
    }
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
