import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { emitToUsers } from "@/lib/eventBus";
import { pushToUsers } from "@/lib/push";

function groupPreviewForPush(content: string, mediaUrl: string | undefined, mediaType: string | undefined): string {
  if (content && content.trim()) return content.trim().slice(0, 140);
  if (mediaUrl) return mediaType === "video" ? "🎥 Video" : "📷 Photo";
  return "New message";
}

async function verifyMembership(userId: string, groupId: string) {
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  return !!membership;
}

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

  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: id, userId } },
  });
  if (!member) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }
  const clearedAt = member.clearedAt || null;

  const messages = await prisma.groupMessage.findMany({
    where: {
      groupId: id,
      ...(clearedAt ? { createdAt: { gt: clearedAt } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: {
      sender: { select: { id: true, name: true, profileImageUrl: true } },
    },
  });

  // Hydrate shared posts
  const sharedPostIds = messages
    .filter((m) => m.sharedPostId)
    .map((m) => m.sharedPostId);

  const sharedPosts = sharedPostIds.length > 0
    ? await prisma.post.findMany({
        where: { id: { in: sharedPostIds } },
        include: {
          author: { select: { id: true, name: true, profileImageUrl: true } },
        },
      })
    : [];

  const postMap = new Map(sharedPosts.map((p) => [p.id, p]));

  // Bump lastReadAt so the inbox unread count clears
  await prisma.groupMember.update({
    where: { groupId_userId: { groupId: id, userId } },
    data: { lastReadAt: new Date() },
  });

  const reactionRows = messages.length
    ? await prisma.messageReaction.findMany({
        where: { messageType: "GROUP", messageId: { in: messages.map((m) => m.id) } },
        include: { user: { select: { id: true, name: true } } },
      })
    : [];
  const reactionsByMessage = new Map<string, { emoji: string; userId: string; userName: string }[]>();
  for (const r of reactionRows) {
    const list = reactionsByMessage.get(r.messageId) || [];
    list.push({ emoji: r.emoji, userId: r.userId, userName: r.user.name });
    reactionsByMessage.set(r.messageId, list);
  }

  const result = messages.map((m) => ({
    id: m.id,
    content: m.content,
    mediaUrl: m.mediaUrl || "",
    mediaType: m.mediaType || "",
    senderId: m.senderId,
    sharedPostId: m.sharedPostId || null,
    sharedPost: m.sharedPostId ? (postMap.get(m.sharedPostId) || null) : null,
    createdAt: m.createdAt,
    sender: m.sender,
    reactions: reactionsByMessage.get(m.id) || [],
  }));

  return NextResponse.json(result);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  if (!(await verifyMembership(session.user.id, id))) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const { content, mediaUrl, mediaType, sharedPostId } = await request.json();

  if (!content?.trim() && !mediaUrl && !sharedPostId) {
    return NextResponse.json({ error: "Content, media, or post required" }, { status: 400 });
  }

  try {
    const message = await prisma.groupMessage.create({
      data: {
        content: (content || "").trim(),
        mediaUrl: mediaUrl || "",
        mediaType: mediaType || "",
        sharedPostId: sharedPostId || "",
        groupId: id,
        senderId: session.user.id,
      },
      include: {
        sender: { select: { id: true, name: true, profileImageUrl: true } },
      },
    });

    let sharedPost = null;
    if (sharedPostId) {
      sharedPost = await prisma.post.findUnique({
        where: { id: sharedPostId },
        include: {
          author: { select: { id: true, name: true, profileImageUrl: true } },
        },
      });
    }

    // Notify every group member except the sender so their inbox/bell update.
    const members = await prisma.groupMember.findMany({
      where: { groupId: id, userId: { not: session.user.id }, muted: false },
      select: { userId: true },
    });
    const memberIds = members.map((m) => m.userId);
    emitToUsers(memberIds, { kind: "inbox" });

    // Push the muted-respecting subset only.
    const groupName = await prisma.group.findUnique({ where: { id }, select: { name: true } });
    void pushToUsers(memberIds, {
      title: groupName?.name || "Group",
      body: `${message.sender.name}: ${groupPreviewForPush(message.content, mediaUrl, mediaType)}`,
      threadId: `group:${id}`,
      data: { kind: "group", groupId: id },
    });

    return NextResponse.json({
      id: message.id,
      content: message.content,
      mediaUrl: message.mediaUrl || "",
      mediaType: message.mediaType || "",
      senderId: message.senderId,
      sharedPostId: message.sharedPostId || null,
      sharedPost,
      createdAt: message.createdAt,
      sender: message.sender,
      reactions: [],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[POST /api/groups/[id]/messages] failed:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
