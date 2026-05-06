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

  // Get friend group IDs the user is a member of
  const userFriendGroupMemberships = await prisma.friendGroupMember.findMany({
    where: { userId },
    select: { friendGroupId: true },
  });
  const userFriendGroupIds = userFriendGroupMemberships.map((m) => m.friendGroupId);

  // Get hidden post IDs
  const hiddenPosts = await prisma.hiddenPost.findMany({
    where: { userId },
    select: { postId: true },
  });
  const hiddenPostIds = hiddenPosts.map((h) => h.postId);

  // Get blocked user IDs (in either direction)
  const blocks = await prisma.block.findMany({
    where: {
      OR: [{ blockerId: userId }, { blockedId: userId }],
    },
  });
  const blockedUserIds = Array.from(
    new Set(blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)))
  );

  // Fetch posts:
  // 1. Own posts (always visible)
  // 2. Friends' posts with NO group targeting (visible to all friends)
  // 3. Friends' posts targeted to groups the user is a member of
  const posts = await prisma.post.findMany({
    where: {
      id: hiddenPostIds.length > 0 ? { notIn: hiddenPostIds } : undefined,
      // Hide posts from blocked users (in either direction)
      ...(blockedUserIds.length > 0
        ? { authorId: { notIn: blockedUserIds } }
        : {}),
      OR: [
        // Own posts
        { authorId: userId },
        // Friends' posts with no targeting (visible to all friends)
        {
          authorId: { in: friendIds },
          postGroups: { none: {} },
          postFriendGroups: { none: {} },
        },
        // Friends' posts targeted to teams I'm in
        {
          authorId: { in: friendIds },
          postGroups: { some: { groupId: { in: userGroupIds } } },
        },
        // Friends' posts targeted to friend groups I'm in
        {
          authorId: { in: friendIds },
          postFriendGroups: { some: { friendGroupId: { in: userFriendGroupIds } } },
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
      postFriendGroups: {
        include: {
          friendGroup: { select: { id: true, name: true } },
        },
      },
      playRequests: {
        select: { id: true, status: true, note: true, userId: true, user: { select: { name: true, profileImageUrl: true } } },
      },
      photos: { orderBy: { order: "asc" }, select: { url: true } },
      _count: { select: { likes: true, comments: true, playRequests: { where: { status: "PENDING" } } } },
    },
  });

  // For every completed find-players post, look up its auto-created session
  // chat so the card can link straight to /chat/group/<id>. One bounded query.
  const completePostIds = posts
    .filter((p) => p.postType === "find_players" && p.isComplete)
    .map((p) => p.id);
  const sessionChats = completePostIds.length
    ? await prisma.chat.findMany({
        where: {
          postId: { in: completePostIds },
          participants: { some: { userId } },
        },
        select: { id: true, postId: true },
      })
    : [];
  const sessionChatByPost = new Map(
    sessionChats.map((c) => [c.postId as string, c.id])
  );

  const formatted = posts.map((post) => ({
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
    // Friend groups are private — only the post author sees which friend group(s) the post was sent to
    friendGroups: post.authorId === userId
      ? post.postFriendGroups.map((pfg) => ({ id: pfg.friendGroup.id, name: pfg.friendGroup.name }))
      : [],
  }));

  return NextResponse.json(formatted);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { content, mediaUrl, mediaType, photoUrls, groupIds, friendGroupIds, postType, playDate, playTime, playDuration, courtLocation, gameType, playersNeeded, courtBooked, skillMin, skillMax } = await request.json();

  // Normalize photoUrls (cap at 9). Falls back to legacy single-image
  // mediaUrl/mediaType pair when photoUrls isn't provided.
  let normalizedPhotoUrls: string[] = [];
  if (Array.isArray(photoUrls)) {
    normalizedPhotoUrls = photoUrls
      .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
      .slice(0, 9);
  }

  // For multi-photo posts, set legacy mediaUrl to the first photo so older
  // consumers (and the chat preview, post grid thumbnail, etc.) still work.
  let resolvedMediaUrl = mediaUrl || "";
  let resolvedMediaType = mediaType || "";
  if (normalizedPhotoUrls.length > 0) {
    resolvedMediaUrl = normalizedPhotoUrls[0];
    resolvedMediaType = "image";
  }

  if (!content?.trim() && !resolvedMediaUrl && postType !== "find_players") {
    return NextResponse.json({ error: "Post must have text or media" }, { status: 400 });
  }

  const post = await prisma.post.create({
    data: {
      content: (content || "").trim(),
      mediaUrl: resolvedMediaUrl,
      mediaType: resolvedMediaType,
      postType: postType || "regular",
      playDate: playDate || "",
      playTime: playTime || "",
      playDuration: Number(playDuration) || 90,
      courtLocation: courtLocation || "",
      gameType: gameType || "",
      playersNeeded: playersNeeded || 0,
      courtBooked: courtBooked || false,
      skillMin: typeof skillMin === "number" ? skillMin : null,
      skillMax: typeof skillMax === "number" ? skillMax : null,
      authorId: session.user.id,
      // Multi-photo: persist the full array (including the first one duplicated
      // in mediaUrl) so the read path can return them in order.
      photos:
        normalizedPhotoUrls.length > 1
          ? {
              create: normalizedPhotoUrls.map((url, i) => ({ url, order: i })),
            }
          : undefined,
      postGroups:
        groupIds && groupIds.length > 0
          ? {
              create: groupIds.map((groupId: string) => ({ groupId })),
            }
          : undefined,
      postFriendGroups:
        friendGroupIds && friendGroupIds.length > 0
          ? {
              create: friendGroupIds.map((friendGroupId: string) => ({ friendGroupId })),
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
      postFriendGroups: {
        include: {
          friendGroup: { select: { id: true, name: true } },
        },
      },
      photos: {
        orderBy: { order: "asc" },
        select: { url: true },
      },
    },
  });

  return NextResponse.json({
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
    friendGroups: post.postFriendGroups.map((pfg) => ({ id: pfg.friendGroup.id, name: pfg.friendGroup.name })),
  });
}
