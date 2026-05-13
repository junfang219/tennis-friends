import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { emitToUser } from "@/lib/eventBus";
import { pushToUser } from "@/lib/push";
import {
  emojiFor,
  isValidMessageType,
  isValidReactionKey,
  type MessageType,
  type ReactionKey,
} from "@/lib/reactions";

// Verify the caller can see the target message — required before they can react to it.
async function canViewMessage(
  userId: string,
  messageType: MessageType,
  messageId: string,
): Promise<boolean> {
  if (messageType === "DM") {
    const m = await prisma.message.findUnique({
      where: { id: messageId },
      select: { senderId: true, receiverId: true },
    });
    if (!m) return false;
    return m.senderId === userId || m.receiverId === userId;
  }
  if (messageType === "GROUP") {
    const m = await prisma.groupMessage.findUnique({
      where: { id: messageId },
      select: { groupId: true },
    });
    if (!m) return false;
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: m.groupId, userId } },
    });
    return !!member;
  }
  // CHAT
  const m = await prisma.chatMessage.findUnique({
    where: { id: messageId },
    select: { chatId: true },
  });
  if (!m) return false;
  const part = await prisma.chatParticipant.findUnique({
    where: { chatId_userId: { chatId: m.chatId, userId } },
  });
  return !!part;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { messageType, messageId, emoji } = body as {
    messageType?: unknown;
    messageId?: unknown;
    emoji?: unknown;
  };

  if (!isValidMessageType(messageType)) {
    return NextResponse.json({ error: "Invalid messageType" }, { status: 400 });
  }
  if (typeof messageId !== "string" || !messageId) {
    return NextResponse.json({ error: "Invalid messageId" }, { status: 400 });
  }
  // emoji === null means "remove my reaction"
  if (emoji !== null && !isValidReactionKey(emoji)) {
    return NextResponse.json({ error: "Invalid emoji" }, { status: 400 });
  }

  if (!(await canViewMessage(userId, messageType, messageId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const existing = await prisma.messageReaction.findUnique({
    where: {
      messageType_messageId_userId: { messageType, messageId, userId },
    },
  });

  // Toggle off when removing or re-tapping the same emoji.
  if (emoji === null || (existing && existing.emoji === emoji)) {
    if (existing) {
      await prisma.messageReaction.delete({ where: { id: existing.id } });
    }
    return NextResponse.json({ ok: true, emoji: null });
  }

  const newKey = emoji as ReactionKey;
  const reaction = await prisma.messageReaction.upsert({
    where: {
      messageType_messageId_userId: { messageType, messageId, userId },
    },
    create: { messageType, messageId, userId, emoji: newKey },
    update: { emoji: newKey },
  });

  // Notify the message author for 1:1 DMs only — group/session reactions are silent.
  // Skip when the actor is the author (no self-notify) and when this user has already
  // reacted on this message before (a re-toggle or emoji change shouldn't ping again).
  if (messageType === "DM" && !existing) {
    const dm = await prisma.message.findUnique({
      where: { id: messageId },
      select: { senderId: true },
    });
    if (dm && dm.senderId !== userId) {
      await prisma.notification.create({
        data: {
          userId: dm.senderId,
          actorId: userId,
          type: "message_reaction",
          messageId,
          emoji: newKey,
        },
      });
      emitToUser(dm.senderId, { kind: "notifications" });

      const actor = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      const symbol = emojiFor(newKey);
      void pushToUser(dm.senderId, {
        title: "Tennis Friend",
        body: `${actor?.name || "Someone"} reacted ${symbol} to your message`,
        threadId: `dm:${userId}`,
        data: { kind: "message_reaction", from: userId, messageId },
      });
    }
  }

  return NextResponse.json({ ok: true, emoji: reaction.emoji });
}
