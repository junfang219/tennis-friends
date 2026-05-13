import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { emitToUser } from "@/lib/eventBus";
import { pushToUser } from "@/lib/push";

function previewForPush(content: string, mediaUrl: string | undefined, mediaType: string | undefined): string {
  if (content && content.trim()) return content.trim().slice(0, 140);
  if (mediaUrl) return mediaType === "video" ? "🎥 Video" : "📷 Photo";
  return "Sent you a message";
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const withUserId = searchParams.get("with");

  if (!withUserId) {
    return NextResponse.json({ error: "Missing 'with' param" }, { status: 400 });
  }

  // Honor the user's clearedAt timestamp — only show messages from after they cleared.
  const myState = await prisma.directMessageRead.findUnique({
    where: { userId_otherId: { userId: session.user.id, otherId: withUserId } },
  });
  const clearedAt = myState?.clearedAt || null;

  const messages = await prisma.message.findMany({
    where: {
      OR: [
        { senderId: session.user.id, receiverId: withUserId },
        { senderId: withUserId, receiverId: session.user.id },
      ],
      ...(clearedAt ? { createdAt: { gt: clearedAt } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: {
      sender: { select: { id: true, name: true, profileImageUrl: true } },
    },
  });

  // Load shared posts for messages that have them
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

  const reactionRows = messages.length
    ? await prisma.messageReaction.findMany({
        where: { messageType: "DM", messageId: { in: messages.map((m) => m.id) } },
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

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { receiverId, content, sharedPostId, mediaUrl, mediaType } = await request.json();

  if (!receiverId || (!content?.trim() && !sharedPostId && !mediaUrl)) {
    return NextResponse.json({ error: "Receiver and content, media, or post required" }, { status: 400 });
  }

  // Refuse if either side has blocked the other
  const block = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: session.user.id, blockedId: receiverId },
        { blockerId: receiverId, blockedId: session.user.id },
      ],
    },
  });
  if (block) {
    return NextResponse.json({ error: "You cannot message this user" }, { status: 403 });
  }

  const message = await prisma.message.create({
    data: {
      content: (content || "").trim(),
      mediaUrl: mediaUrl || "",
      mediaType: mediaType || "",
      senderId: session.user.id,
      receiverId,
      sharedPostId: sharedPostId || "",
    },
    include: {
      sender: { select: { id: true, name: true, profileImageUrl: true } },
    },
  });

  // Load shared post if present
  let sharedPost = null;
  if (sharedPostId) {
    sharedPost = await prisma.post.findUnique({
      where: { id: sharedPostId },
      include: {
        author: { select: { id: true, name: true, profileImageUrl: true } },
      },
    });
  }

  // Wake the recipient's bells in real time. Sender's own UI updates via the
  // local optimistic insert in the chat page; no need to emit to self.
  emitToUser(receiverId, { kind: "inbox" });
  emitToUser(receiverId, { kind: "messages", with: session.user.id });

  // Background push for the recipient. SSE handles foreground; this fires the
  // banner when the iOS app is backgrounded or killed.
  void pushToUser(receiverId, {
    title: message.sender.name || "New message",
    body: previewForPush(message.content, mediaUrl, mediaType),
    threadId: `dm:${session.user.id}`,
    data: { kind: "dm", from: session.user.id },
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
}
