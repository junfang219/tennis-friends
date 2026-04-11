import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// GET all chats the current user participates in
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  const myParticipations = await prisma.chatParticipant.findMany({
    where: { userId },
    select: { chatId: true, lastReadAt: true },
  });
  const lastReadByChat = new Map(myParticipations.map((p) => [p.chatId, p.lastReadAt]));
  const chatIds = myParticipations.map((p) => p.chatId);

  if (chatIds.length === 0) {
    return NextResponse.json([]);
  }

  const chats = await prisma.chat.findMany({
    where: { id: { in: chatIds } },
    include: {
      participants: {
        include: {
          user: { select: { id: true, name: true, profileImageUrl: true } },
        },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          sender: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Compute unread counts
  const result = await Promise.all(
    chats.map(async (chat) => {
      const lastReadAt = lastReadByChat.get(chat.id) || new Date(0);
      const unreadCount = await prisma.chatMessage.count({
        where: {
          chatId: chat.id,
          createdAt: { gt: lastReadAt },
          senderId: { not: userId },
        },
      });
      return {
        id: chat.id,
        name: chat.name,
        creatorId: chat.creatorId,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        participants: chat.participants.map((p) => p.user),
        lastMessage: chat.messages[0]
          ? {
              id: chat.messages[0].id,
              content: chat.messages[0].content,
              senderId: chat.messages[0].senderId,
              senderName: chat.messages[0].sender.name,
              createdAt: chat.messages[0].createdAt,
            }
          : null,
        unreadCount,
      };
    })
  );

  return NextResponse.json(result);
}

// POST create a new chat
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const { participantIds, name } = await request.json();

  if (!Array.isArray(participantIds) || participantIds.length < 1) {
    return NextResponse.json({ error: "At least one participant required" }, { status: 400 });
  }

  // Filter out the creator (auto-added) and dedupe
  const uniqueParticipants = Array.from(new Set(participantIds.filter((id: string) => id && id !== userId)));

  if (uniqueParticipants.length < 1) {
    return NextResponse.json({ error: "At least one other participant required" }, { status: 400 });
  }

  // Validate all participants are accepted friends of the creator
  const friendships = await prisma.friendship.findMany({
    where: {
      status: "ACCEPTED",
      OR: [
        { requesterId: userId, addresseeId: { in: uniqueParticipants } },
        { addresseeId: userId, requesterId: { in: uniqueParticipants } },
      ],
    },
  });
  const friendIds = new Set(
    friendships.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId))
  );
  const invalidIds = uniqueParticipants.filter((id) => !friendIds.has(id));
  if (invalidIds.length > 0) {
    return NextResponse.json({ error: "All participants must be your friends" }, { status: 400 });
  }

  const chat = await prisma.chat.create({
    data: {
      name: (name || "").trim(),
      creatorId: userId,
      participants: {
        create: [
          { userId },
          ...uniqueParticipants.map((id) => ({ userId: id })),
        ],
      },
    },
    include: {
      participants: {
        include: {
          user: { select: { id: true, name: true, profileImageUrl: true } },
        },
      },
    },
  });

  return NextResponse.json({
    id: chat.id,
    name: chat.name,
    creatorId: chat.creatorId,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    participants: chat.participants.map((p) => p.user),
    lastMessage: null,
    unreadCount: 0,
  });
}
