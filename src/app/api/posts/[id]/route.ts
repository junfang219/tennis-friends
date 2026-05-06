import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ensureSessionChat } from "@/lib/sessionChat";

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
      photos: { orderBy: { order: "asc" }, select: { url: true } },
      _count: { select: { likes: true, comments: true, playRequests: { where: { status: "PENDING" } } } },
    },
  });

  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  let sessionChatId: string | null = null;
  if (post.postType === "find_players" && post.isComplete) {
    const chat = await prisma.chat.findFirst({
      where: {
        postId: post.id,
        participants: { some: { userId } },
      },
      select: { id: true },
    });
    sessionChatId = chat?.id || null;
    // Back-fill: if the post is complete but no chat exists yet (e.g. it was
    // marked full manually before this feature), create one now lazily — but
    // only when the viewer is a participant (author or approved player).
    if (!sessionChatId) {
      const isParticipant =
        post.authorId === userId ||
        post.playRequests.some((r) => r.userId === userId && r.status === "APPROVED");
      if (isParticipant) {
        try {
          sessionChatId = await ensureSessionChat(post.id);
        } catch (err) {
          console.error("ensureSessionChat (lazy) failed:", err);
        }
      }
    }
  }

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
    playersConfirmed: post.playersConfirmed,
    courtBooked: post.courtBooked,
    isComplete: post.isComplete,
    sessionChatId,
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

  // Clean up any auto-created session chat tied to this post. Chat has
  // nullable postId (no FK cascade), so do this explicitly. ChatParticipant
  // and ChatMessage cascade off Chat.
  await prisma.chat.deleteMany({ where: { postId: id } });

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
  if (body.skillMin !== undefined) updates.skillMin = body.skillMin === null ? null : Number(body.skillMin);
  if (body.skillMax !== undefined) updates.skillMax = body.skillMax === null ? null : Number(body.skillMax);
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

  let sessionChatId: string | null = null;
  if (updated.postType === "find_players" && updated.isComplete) {
    try {
      sessionChatId = await ensureSessionChat(updated.id);
    } catch (err) {
      console.error("ensureSessionChat failed:", err);
    }
  }

  return NextResponse.json({
    ...updated,
    sessionChatId,
    groups: updated.postGroups.map((pg) => ({ id: pg.group.id, name: pg.group.name })),
    friendGroups: updated.postFriendGroups.map((pfg) => ({ id: pfg.friendGroup.id, name: pfg.friendGroup.name })),
  });
}
