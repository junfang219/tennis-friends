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
  const userId = session.user.id;

  const post = await prisma.post.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, name: true, profileImageUrl: true } },
      likes: { where: { userId }, select: { id: true } },
      postGroups: { include: { group: { select: { id: true, name: true } } } },
      postFriendGroups: { include: { friendGroup: { select: { id: true, name: true } } } },
      playRequests: { select: { id: true, status: true, note: true, userId: true, user: { select: { name: true } } } },
      _count: { select: { likes: true, comments: true, playRequests: { where: { status: "PENDING" } } } },
    },
  });

  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

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
    myPlayRequest: post.playRequests.find((r) => r.userId === userId) || null,
    approvedPlayerNames: (post.authorId === userId || post.playRequests.some((r) => r.userId === userId && (r.status === "APPROVED" || r.status === "PENDING")))
      ? post.playRequests.filter((r) => r.status === "APPROVED").map((r) => r.user.name)
      : [],
    manualPlayers: (post.authorId === userId || post.playRequests.some((r) => r.userId === userId && (r.status === "APPROVED" || r.status === "PENDING")))
      ? post.manualPlayers
      : "",
    groups: post.postGroups.map((pg) => ({ id: pg.group.id, name: pg.group.name })),
    // Friend groups are private — only the post author can see them
    friendGroups: post.authorId === userId
      ? post.postFriendGroups.map((pfg) => ({ id: pfg.friendGroup.id, name: pfg.friendGroup.name }))
      : [],
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const post = await prisma.post.findUnique({ where: { id } });
  if (!post || post.authorId !== session.user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  await prisma.post.delete({ where: { id } });

  return NextResponse.json({ success: true });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const post = await prisma.post.findUnique({ where: { id } });
  if (!post || post.authorId !== session.user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json();
  const updates: Record<string, unknown> = {};

  if (body.content !== undefined) updates.content = body.content;
  if (body.commentsDisabled !== undefined) updates.commentsDisabled = body.commentsDisabled;
  if (body.playDate !== undefined) updates.playDate = body.playDate;
  if (body.playTime !== undefined) updates.playTime = body.playTime;
  if (body.playDuration !== undefined) updates.playDuration = Number(body.playDuration) || 90;
  if (body.courtLocation !== undefined) updates.courtLocation = body.courtLocation;
  if (body.gameType !== undefined) updates.gameType = body.gameType;
  if (body.playersNeeded !== undefined) updates.playersNeeded = body.playersNeeded;
  if (body.playersConfirmed !== undefined) updates.playersConfirmed = body.playersConfirmed;
  if (body.courtBooked !== undefined) updates.courtBooked = body.courtBooked;
  if (body.isComplete !== undefined) updates.isComplete = body.isComplete;
  if (body.manualPlayers !== undefined) updates.manualPlayers = body.manualPlayers;

  // Handle audience updates: replace post's targeted teams / friend groups
  if (Array.isArray(body.groupIds)) {
    await prisma.postGroup.deleteMany({ where: { postId: id } });
    if (body.groupIds.length > 0) {
      await prisma.postGroup.createMany({
        data: body.groupIds.map((groupId: string) => ({ postId: id, groupId })),
      });
    }
  }

  if (Array.isArray(body.friendGroupIds)) {
    await prisma.postFriendGroup.deleteMany({ where: { postId: id } });
    if (body.friendGroupIds.length > 0) {
      await prisma.postFriendGroup.createMany({
        data: body.friendGroupIds.map((friendGroupId: string) => ({ postId: id, friendGroupId })),
      });
    }
  }

  const updated = await prisma.post.update({
    where: { id },
    data: updates,
    include: {
      postGroups: { include: { group: { select: { id: true, name: true } } } },
      postFriendGroups: { include: { friendGroup: { select: { id: true, name: true } } } },
    },
  });

  return NextResponse.json({
    ...updated,
    groups: updated.postGroups.map((pg) => ({ id: pg.group.id, name: pg.group.name })),
    friendGroups: updated.postFriendGroups.map((pfg) => ({ id: pfg.friendGroup.id, name: pfg.friendGroup.name })),
  });
}
