import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

async function verifyParticipant(userId: string, chatId: string) {
  const participant = await prisma.chatParticipant.findUnique({
    where: { chatId_userId: { chatId, userId } },
  });
  return !!participant;
}

// GET chat metadata
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  if (!(await verifyParticipant(session.user.id, id))) {
    return NextResponse.json({ error: "Not a participant" }, { status: 403 });
  }

  const chat = await prisma.chat.findUnique({
    where: { id },
    include: {
      participants: {
        include: {
          user: { select: { id: true, name: true, profileImageUrl: true } },
        },
      },
    },
  });

  if (!chat) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  const guestNames = (chat.manualPlayerNames || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return NextResponse.json({
    id: chat.id,
    name: chat.name,
    creatorId: chat.creatorId,
    createdAt: chat.createdAt,
    participants: chat.participants.map((p) => p.user),
    guestNames,
  });
}

// PATCH rename chat and/or add/remove participants
export async function PATCH(
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

  const chatRecord = await prisma.chat.findUnique({ where: { id } });
  if (!chatRecord) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }
  const isCreator = chatRecord.creatorId === userId;

  const body = await request.json();

  // Rename
  if (typeof body.name === "string") {
    await prisma.chat.update({
      where: { id },
      data: { name: body.name.trim() },
    });
  }

  // Add members — must be friends of the caller, and not already participants
  if (Array.isArray(body.addMemberIds) && body.addMemberIds.length > 0) {
    const toAdd = Array.from(new Set(body.addMemberIds.filter((x: string) => x && x !== userId)));

    // Validate friendship for each
    const friendships = await prisma.friendship.findMany({
      where: {
        status: "ACCEPTED",
        OR: [
          { requesterId: userId, addresseeId: { in: toAdd as string[] } },
          { addresseeId: userId, requesterId: { in: toAdd as string[] } },
        ],
      },
    });
    const friendIds = new Set(
      friendships.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId))
    );
    const invalid = (toAdd as string[]).filter((x) => !friendIds.has(x));
    if (invalid.length > 0) {
      return NextResponse.json({ error: "All new members must be your friends" }, { status: 400 });
    }

    for (const memberId of toAdd as string[]) {
      await prisma.chatParticipant.upsert({
        where: { chatId_userId: { chatId: id, userId: memberId } },
        update: {},
        create: { chatId: id, userId: memberId },
      });
    }
  }

  // Remove members — only the chat creator can remove other participants.
  // Caller cannot remove themselves via this path (use DELETE/leave instead).
  if (Array.isArray(body.removeMemberIds) && body.removeMemberIds.length > 0) {
    if (!isCreator) {
      return NextResponse.json(
        { error: "Only the chat creator can remove members" },
        { status: 403 }
      );
    }
    const toRemove = (body.removeMemberIds as string[]).filter((x) => x && x !== userId);
    if (toRemove.length > 0) {
      await prisma.chatParticipant.deleteMany({
        where: {
          chatId: id,
          userId: { in: toRemove },
        },
      });
    }
  }

  // Bump updatedAt and return fresh chat info
  await prisma.chat.update({ where: { id }, data: { updatedAt: new Date() } });

  const fresh = await prisma.chat.findUnique({
    where: { id },
    include: {
      participants: {
        include: { user: { select: { id: true, name: true, profileImageUrl: true } } },
      },
    },
  });

  return NextResponse.json({
    id: fresh!.id,
    name: fresh!.name,
    creatorId: fresh!.creatorId,
    participants: fresh!.participants.map((p) => p.user),
  });
}

// DELETE leave chat (removes the caller; deletes chat if empty)
export async function DELETE(
  _request: Request,
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

  await prisma.chatParticipant.delete({
    where: { chatId_userId: { chatId: id, userId } },
  });

  const remaining = await prisma.chatParticipant.count({ where: { chatId: id } });
  if (remaining === 0) {
    await prisma.chat.delete({ where: { id } });
  }

  return NextResponse.json({ success: true });
}
