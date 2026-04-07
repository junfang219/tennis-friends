import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { requestId, note } = await request.json();

  const playRequest = await prisma.playRequest.findUnique({
    where: { id: requestId },
    include: { post: true },
  });

  if (!playRequest || playRequest.post.authorId !== session.user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  if (playRequest.status !== "APPROVED") {
    return NextResponse.json({ error: "Player is not approved" }, { status: 400 });
  }

  const newConfirmed = Math.max(0, playRequest.post.playersConfirmed - 1);

  await prisma.$transaction([
    prisma.playRequest.update({
      where: { id: requestId },
      data: { status: "REMOVED", note: note || "" },
    }),
    prisma.post.update({
      where: { id: playRequest.postId },
      data: {
        playersConfirmed: newConfirmed,
        isComplete: false,
      },
    }),
  ]);

  // Send message to the removed player with the post card
  const creator = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true },
  });

  await prisma.message.create({
    data: {
      content: note?.trim()
        ? `${creator?.name || "The organizer"} removed you from the game: "${note.trim()}"`
        : `${creator?.name || "The organizer"} removed you from the game`,
      senderId: session.user.id,
      receiverId: playRequest.userId,
      sharedPostId: playRequest.postId,
    },
  });

  return NextResponse.json({ success: true, playersConfirmed: newConfirmed });
}
