import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { validateHandle } from "@/lib/handle";
import { parseTags, serializeTags } from "@/lib/tags";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
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
      latitude: true,
      longitude: true,
      gender: true,
      ageRange: true,
      ratingSystem: true,
      ntrpRating: true,
      utrRating: true,
      handle: true,
      venmoHandle: true,
      paypalHandle: true,
      cashappHandle: true,
      zelleHandle: true,
      createdAt: true,
      highlights: { orderBy: { createdAt: "desc" } },
      _count: { select: { sentRequests: { where: { status: "ACCEPTED" } }, receivedRequests: { where: { status: "ACCEPTED" } } } },
      posts: {
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

  // Posts where the viewer is an approved player on someone else's find_players
  // post — surfaced on their profile so they can see the games they're in.
  const joinedPosts = await prisma.post.findMany({
    where: {
      postType: "find_players",
      authorId: { not: session.user.id },
      playRequests: {
        some: { userId: session.user.id, status: "APPROVED" },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      author: { select: { id: true, name: true, profileImageUrl: true } },
      likes: { where: { userId: session.user.id }, select: { id: true } },
      postGroups: { include: { group: { select: { id: true, name: true } } } },
      playRequests: {
        select: { id: true, status: true, note: true, userId: true, user: { select: { name: true } } },
      },
      photos: { orderBy: { order: "asc" }, select: { url: true } },
      _count: { select: { likes: true, comments: true, playRequests: { where: { status: "PENDING" } } } },
    },
  });

  const completePostIds = [
    ...user.posts.filter((p) => p.postType === "find_players" && p.isComplete).map((p) => p.id),
    ...joinedPosts.filter((p) => p.isComplete).map((p) => p.id),
  ];
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

  const ownFormatted = user.posts.map((post) => ({
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
    author: { id: user.id, name: user.name, profileImageUrl: user.profileImageUrl },
    likeCount: post._count.likes,
    commentCount: post._count.comments,
    pendingRequestCount: post._count.playRequests,
    isLiked: post.likes.length > 0,
    myPlayRequest: post.playRequests.find((r) => r.userId === session.user!.id) || null,
    approvedPlayerNames: post.playRequests.filter((r) => r.status === "APPROVED").map((r) => r.user.name),
    manualPlayers: post.manualPlayers,
    groups: post.postGroups.map((pg) => ({ id: pg.group.id, name: pg.group.name })),
  }));

  const joinedFormatted = joinedPosts.map((post) => ({
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
    myPlayRequest: post.playRequests.find((r) => r.userId === session.user!.id) || null,
    approvedPlayerNames: post.playRequests.filter((r) => r.status === "APPROVED").map((r) => r.user.name),
    manualPlayers: post.manualPlayers,
    groups: post.postGroups.map((pg) => ({ id: pg.group.id, name: pg.group.name })),
  }));

  // Merge own + joined, dedupe by id, sort by createdAt desc.
  const seen = new Set<string>();
  const posts = [...ownFormatted, ...joinedFormatted]
    .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return NextResponse.json({ ...user, customTags: parseTags(user.customTags), posts });
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const data = await request.json();
  const stringFields = ["name", "bio", "skillLevel", "favoriteSurface", "profileImageUrl", "coverImageUrl", "gender", "ageRange", "ratingSystem", "venmoHandle", "paypalHandle", "cashappHandle", "zelleHandle"];
  const numberFields = ["ntrpRating", "utrRating", "coverOffsetY", "coverScale", "latitude", "longitude"];
  const updates: Record<string, unknown> = {};
  for (const key of stringFields) {
    if (data[key] !== undefined) updates[key] = data[key];
  }
  for (const key of numberFields) {
    if (data[key] !== undefined) updates[key] = data[key] === null ? null : Number(data[key]);
  }

  // customTags: accept array of strings; serialize to CSV with caps applied.
  if (Array.isArray(data.customTags)) {
    updates.customTags = serializeTags(data.customTags as string[]);
  }

  // Handle field has its own validation + uniqueness check.
  if (data.handle !== undefined) {
    const raw = String(data.handle || "");
    if (raw.trim() === "") {
      updates.handle = null;
    } else {
      const v = validateHandle(raw);
      if (!v.ok) {
        return NextResponse.json({ error: v.error, field: "handle" }, { status: 400 });
      }
      const taken = await prisma.user.findUnique({ where: { handle: v.value } });
      if (taken && taken.id !== session.user.id) {
        return NextResponse.json({ error: "Handle is already taken.", field: "handle" }, { status: 409 });
      }
      updates.handle = v.value;
    }
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: updates,
  });

  return NextResponse.json({ ...user, customTags: parseTags(user.customTags) });
}
