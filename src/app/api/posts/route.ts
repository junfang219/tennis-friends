import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Get accepted friend IDs
  const friendships = await prisma.friendship.findMany({
    where: {
      status: "ACCEPTED",
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
  });

  const friendIds = friendships.map((f) =>
    f.requesterId === userId ? f.addresseeId : f.requesterId
  );

  // Get group IDs the user is a member of
  const userGroupMemberships = await prisma.groupMember.findMany({
    where: { userId },
    select: { groupId: true },
  });
  const userGroupIds = userGroupMemberships.map((m) => m.groupId);

  // Get hidden post IDs
  const hiddenPosts = await prisma.hiddenPost.findMany({
    where: { userId },
    select: { postId: true },
  });
  const hiddenPostIds = hiddenPosts.map((h) => h.postId);

  // Fetch posts:
  // 1. Own posts (always visible)
  // 2. Friends' posts with NO group targeting (visible to all friends)
  // 3. Friends' posts targeted to groups the user is a member of
  const posts = await prisma.post.findMany({
    where: {
      id: hiddenPostIds.length > 0 ? { notIn: hiddenPostIds } : undefined,
      OR: [
        // Own posts
        { authorId: userId },
        // Friends' posts with no group targeting
        {
          authorId: { in: friendIds },
          postGroups: { none: {} },
        },
        // Friends' posts targeted to groups I'm in
        {
          authorId: { in: friendIds },
          postGroups: { some: { groupId: { in: userGroupIds } } },
        },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      author: {
        select: { id: true, name: true, profileImageUrl: true },
      },
      likes: {
        where: { userId },
        select: { id: true },
      },
      postGroups: {
        include: {
          group: { select: { id: true, name: true } },
        },
      },
      playRequests: {
        select: { id: true, status: true, note: true, userId: true, user: { select: { name: true, profileImageUrl: true } } },
      },
      _count: { select: { likes: true, comments: true, playRequests: { where: { status: "PENDING" } } } },
    },
  });

  const formatted = posts.map((post) => ({
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
    likeId: post.likes[0]?.id || null,
    myPlayRequest: post.playRequests.find((r) => r.userId === userId) || null,
    approvedPlayerNames: (post.authorId === userId || post.playRequests.some((r) => r.userId === userId && (r.status === "APPROVED" || r.status === "PENDING")))
      ? post.playRequests.filter((r) => r.status === "APPROVED").map((r) => r.user.name)
      : [],
    manualPlayers: (post.authorId === userId || post.playRequests.some((r) => r.userId === userId && (r.status === "APPROVED" || r.status === "PENDING")))
      ? post.manualPlayers
      : "",
    groups: post.postGroups.map((pg) => ({ id: pg.group.id, name: pg.group.name })),
  }));

  return NextResponse.json(formatted);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { content, mediaUrl, mediaType, groupIds, postType, playDate, playTime, courtLocation, gameType, playersNeeded, courtBooked } = await request.json();

  if (!content?.trim() && !mediaUrl && postType !== "find_players") {
    return NextResponse.json({ error: "Post must have text or media" }, { status: 400 });
  }

  const post = await prisma.post.create({
    data: {
      content: (content || "").trim(),
      mediaUrl: mediaUrl || "",
      mediaType: mediaType || "",
      postType: postType || "regular",
      playDate: playDate || "",
      playTime: playTime || "",
      courtLocation: courtLocation || "",
      gameType: gameType || "",
      playersNeeded: playersNeeded || 0,
      courtBooked: courtBooked || false,
      authorId: session.user.id,
      postGroups:
        groupIds && groupIds.length > 0
          ? {
              create: groupIds.map((groupId: string) => ({ groupId })),
            }
          : undefined,
    },
    include: {
      author: { select: { id: true, name: true, profileImageUrl: true } },
      _count: { select: { likes: true } },
      postGroups: {
        include: {
          group: { select: { id: true, name: true } },
        },
      },
    },
  });

  return NextResponse.json({
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
    playersConfirmed: 0,
    courtBooked: post.courtBooked,
    isComplete: false,
    createdAt: post.createdAt,
    author: post.author,
    likeCount: 0,
    commentCount: 0,
    pendingRequestCount: 0,
    isLiked: false,
    likeId: null,
    myPlayRequest: null,
    groups: post.postGroups.map((pg) => ({ id: pg.group.id, name: pg.group.name })),
  });
}
