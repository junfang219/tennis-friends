import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

async function verifyParticipant(userId: string, chatId: string) {
  const participant = await prisma.chatParticipant.findUnique({
    where: { chatId_userId: { chatId, userId } },
  });
  return !!participant;
}

// GET messages for a chat (also marks the caller's lastReadAt)
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

  const participant = await prisma.chatParticipant.findUnique({
    where: { chatId_userId: { chatId: id, userId } },
  });
  if (!participant) {
    return NextResponse.json({ error: "Not a participant" }, { status: 403 });
  }
  const clearedAt = participant.clearedAt || null;

  const messages = await prisma.chatMessage.findMany({
    where: {
      chatId: id,
      ...(clearedAt ? { createdAt: { gt: clearedAt } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: {
      sender: { select: { id: true, name: true, profileImageUrl: true } },
    },
  });

  // Bump lastReadAt so unread counts clear
  await prisma.chatParticipant.update({
    where: { chatId_userId: { chatId: id, userId } },
    data: { lastReadAt: new Date() },
  });

  return NextResponse.json(messages);
}

// POST send a message
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const userId = session.user.id;

  if (!(await verifyParticipant(userId, id))) {
    return NextResponse.json({ error: "Not a participant" }, { status: 403 });
  }

  const { content, mediaUrl, mediaType } = await request.json();
  if (!content?.trim() && !mediaUrl) {
    return NextResponse.json({ error: "Content or media required" }, { status: 400 });
  }

  const message = await prisma.chatMessage.create({
    data: {
      content: (content || "").trim(),
      mediaUrl: mediaUrl || "",
      mediaType: mediaType || "",
      chatId: id,
      senderId: userId,
    },
    include: {
      sender: { select: { id: true, name: true, profileImageUrl: true } },
    },
  });

  // Bump chat updatedAt and the sender's lastReadAt
  await prisma.chat.update({ where: { id }, data: { updatedAt: new Date() } });
  await prisma.chatParticipant.update({
    where: { chatId_userId: { chatId: id, userId } },
    data: { lastReadAt: new Date() },
  });

  return NextResponse.json(message);
}
