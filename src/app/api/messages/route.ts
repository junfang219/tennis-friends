import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

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

  const messages = await prisma.message.findMany({
    where: {
      OR: [
        { senderId: session.user.id, receiverId: withUserId },
        { senderId: withUserId, receiverId: session.user.id },
      ],
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

  const result = messages.map((m) => ({
    id: m.id,
    content: m.content,
    senderId: m.senderId,
    sharedPostId: m.sharedPostId || null,
    sharedPost: m.sharedPostId ? (postMap.get(m.sharedPostId) || null) : null,
    createdAt: m.createdAt,
    sender: m.sender,
  }));

  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { receiverId, content, sharedPostId } = await request.json();

  if (!receiverId || (!content?.trim() && !sharedPostId)) {
    return NextResponse.json({ error: "Receiver and content or post required" }, { status: 400 });
  }

  const message = await prisma.message.create({
    data: {
      content: (content || "").trim(),
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

  return NextResponse.json({
    id: message.id,
    content: message.content,
    senderId: message.senderId,
    sharedPostId: message.sharedPostId || null,
    sharedPost,
    createdAt: message.createdAt,
    sender: message.sender,
  });
}
