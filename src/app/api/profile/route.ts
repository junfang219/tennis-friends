import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

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
      gender: true,
      ageRange: true,
      ratingSystem: true,
      ntrpRating: true,
      utrRating: true,
      createdAt: true,
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
          _count: { select: { likes: true, comments: true, playRequests: { where: { status: "PENDING" } } } },
        },
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

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

  return NextResponse.json({ ...user, posts });
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const data = await request.json();
  const stringFields = ["name", "bio", "skillLevel", "favoriteSurface", "profileImageUrl", "gender", "ageRange", "ratingSystem"];
  const numberFields = ["ntrpRating", "utrRating"];
  const updates: Record<string, unknown> = {};
  for (const key of stringFields) {
    if (data[key] !== undefined) updates[key] = data[key];
  }
  for (const key of numberFields) {
    if (data[key] !== undefined) updates[key] = data[key] === null ? null : Number(data[key]);
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: updates,
  });

  return NextResponse.json(user);
}
