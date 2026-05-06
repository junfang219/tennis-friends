import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { parseTags } from "@/lib/tags";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Block check — if either side has blocked, return a stub response
  const block = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: session.user.id, blockedId: id },
        { blockerId: id, blockedId: session.user.id },
      ],
    },
  });
  if (block) {
    const blockedByMe = block.blockerId === session.user.id;
    // Return a stub profile so the page can show a friendly blocked state
    const stub = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, profileImageUrl: true, coverImageUrl: true },
    });
    return NextResponse.json({
      ...stub,
      isBlocked: true,
      blockedByMe,
      bio: "",
      skillLevel: "",
      favoriteSurface: "",
      gender: "",
      ageRange: "",
      ratingSystem: "",
      ntrpRating: null,
      utrRating: null,
      handle: null,
      customTags: [],
      posts: [],
      friendCount: 0,
      friendshipId: null,
      friendshipStatus: null,
      isRequester: false,
    });
  }

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
      coverImageUrl: true,
      coverOffsetY: true,
      coverScale: true,
      customTags: true,
      gender: true,
      ageRange: true,
      ratingSystem: true,
      ntrpRating: true,
      utrRating: true,
      handle: true,
      createdAt: true,
      highlights: { orderBy: { createdAt: "desc" } },
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
          photos: { orderBy: { order: "asc" }, select: { url: true } },
          _count: { select: { likes: true, comments: true, playRequests: { where: { status: "PENDING" } } } },
        },
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const completePostIds = user.posts
    .filter((p) => p.postType === "find_players" && p.isComplete)
    .map((p) => p.id);
  const sessionChats = completePostIds.length
    ? await prisma.chat.findMany({
        where: {
          postId: { in: completePostIds },
          participants: { some: { userId: session.user.id } },
        },
        select: { id: true, postId: true },
      })
    : [];
  const sessionChatByPost = new Map(
    sessionChats.map((c) => [c.postId as string, c.id])
  );

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
    photoUrls:
      post.photos.length > 0
        ? post.photos.map((p) => p.url)
        : post.mediaType === "image" && post.mediaUrl
        ? [post.mediaUrl]
        : [],
    postType: post.postType,
    playDate: post.playDate,
    playTime: post.playTime,
    playDuration: post.playDuration,
    courtLocation: post.courtLocation,
    gameType: post.gameType,
    playersNeeded: post.playersNeeded,
    skillMin: post.skillMin,
    skillMax: post.skillMax,
    playersConfirmed: post.playersConfirmed,
    courtBooked: post.courtBooked,
    isComplete: post.isComplete,
    sessionChatId: sessionChatByPost.get(post.id) || null,
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
    customTags: parseTags(user.customTags),
    posts,
    friendCount,
    friendshipId: friendship?.id || null,
    friendshipStatus: friendship?.status || null,
    isRequester: friendship?.requesterId === session.user.id,
    isBlocked: false,
    blockedByMe: false,
  });
}
