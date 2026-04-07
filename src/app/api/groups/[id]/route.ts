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

  // Check membership
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: id, userId: session.user.id } },
  });

  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const group = await prisma.group.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true, profileImageUrl: true } },
      members: {
        include: {
          user: { select: { id: true, name: true, profileImageUrl: true, skillLevel: true } },
        },
      },
      _count: { select: { members: true } },
    },
  });

  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  // Get posts targeted to this group
  const posts = await prisma.post.findMany({
    where: {
      postGroups: { some: { groupId: id } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      author: {
        select: { id: true, name: true, profileImageUrl: true },
      },
      likes: {
        where: { userId: session.user.id },
        select: { id: true },
      },
      postGroups: {
        include: {
          group: { select: { id: true, name: true } },
        },
      },
      playRequests: {
        select: { id: true, status: true, note: true, userId: true, user: { select: { name: true } } },
      },
      _count: { select: { likes: true, comments: true, playRequests: { where: { status: "PENDING" } } } },
    },
  });

  const formattedPosts = posts.map((post) => ({
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
    author: post.author,
    likeCount: post._count.likes,
    commentCount: post._count.comments,
    pendingRequestCount: post._count.playRequests,
    isLiked: post.likes.length > 0,
    myPlayRequest: post.playRequests.find((r) => r.userId === session.user!.id) || null,
    approvedPlayerNames: (post.authorId === session.user!.id || post.playRequests.some((r) => r.userId === session.user!.id && (r.status === "APPROVED" || r.status === "PENDING")))
      ? post.playRequests.filter((r) => r.status === "APPROVED").map((r) => r.user.name)
      : [],
    manualPlayers: (post.authorId === session.user!.id || post.playRequests.some((r) => r.userId === session.user!.id && (r.status === "APPROVED" || r.status === "PENDING")))
      ? post.manualPlayers
      : "",
    groups: post.postGroups.map((pg) => ({ id: pg.group.id, name: pg.group.name })),
  }));

  return NextResponse.json({ ...group, posts: formattedPosts });
}
