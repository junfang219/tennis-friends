import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Get groups the current user is a member of
  const userGroupMemberships = await prisma.groupMember.findMany({
    where: { userId: session.user.id },
    select: { groupId: true },
  });
  const userGroupIds = userGroupMemberships.map((m) => m.groupId);

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      bio: true,
      skillLevel: true,
      favoriteSurface: true,
      profileImageUrl: true,
      createdAt: true,
      posts: {
        where: {
          OR: [
            // Posts with no group targeting (visible to all friends)
            { postGroups: { none: {} } },
            // Posts targeted to groups I'm in
            { postGroups: { some: { groupId: { in: userGroupIds } } } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          likes: {
            where: { userId: session.user.id },
            select: { id: true },
          },
          postGroups: {
            include: { group: { select: { id: true, name: true } } },
          },
          playRequests: {
            select: { id: true, status: true, note: true, userId: true, user: { select: { name: true } } },
          },
          _count: { select: { likes: true, comments: true, playRequests: { where: { status: "PENDING" } } } },
        },
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const friendship = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: session.user.id, addresseeId: id },
        { addresseeId: session.user.id, requesterId: id },
      ],
    },
  });

  const friendCount = await prisma.friendship.count({
    where: {
      status: "ACCEPTED",
      OR: [{ requesterId: id }, { addresseeId: id }],
    },
  });

  const posts = user.posts.map((post) => ({
    id: post.id,
    content: post.content,
    mediaUrl: post.mediaUrl,
    mediaType: post.mediaType,
    postType: post.postType,
    playDate: post.playDate,
    playTime: post.playTime,
    courtLocation: post.courtLocation,
    gameType: post.gameType,
    playersNeeded: post.playersNeeded,
    playersConfirmed: post.playersConfirmed,
    courtBooked: post.courtBooked,
    isComplete: post.isComplete,
    commentsDisabled: post.commentsDisabled,
    createdAt: post.createdAt,
    _count: post._count,
    myPlayRequest: post.playRequests.find((r) => r.userId === session.user!.id) || null,
    approvedPlayerNames: (post.authorId === session.user!.id || post.playRequests.some((r) => r.userId === session.user!.id && (r.status === "APPROVED" || r.status === "PENDING")))
      ? post.playRequests.filter((r) => r.status === "APPROVED").map((r) => r.user.name)
      : [],
    manualPlayers: (post.authorId === session.user!.id || post.playRequests.some((r) => r.userId === session.user!.id && (r.status === "APPROVED" || r.status === "PENDING")))
      ? post.manualPlayers
      : "",
    groups: post.postGroups.map((pg) => ({ id: pg.group.id, name: pg.group.name })),
  }));

  return NextResponse.json({
    ...user,
    posts,
    friendCount,
    friendshipId: friendship?.id || null,
    friendshipStatus: friendship?.status || null,
    isRequester: friendship?.requesterId === session.user.id,
  });
}
