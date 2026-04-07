import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { postId, note } = await request.json();

  const playRequest = await prisma.playRequest.findUnique({
    where: { postId_userId: { postId, userId: session.user.id } },
    include: { post: true },
  });

  if (!playRequest) {
    return NextResponse.json({ error: "No request found" }, { status: 404 });
  }

  if (playRequest.status === "PENDING") {
    // Cancel: just delete the request
    await prisma.playRequest.delete({
      where: { id: playRequest.id },
    });
    return NextResponse.json({ action: "cancelled" });
  }

  if (playRequest.status === "APPROVED") {
    // Withdraw: update status, decrement confirmed count, un-complete the post
    await prisma.$transaction([
      prisma.playRequest.update({
        where: { id: playRequest.id },
        data: { status: "WITHDRAWN", note: note || "" },
      }),
      prisma.post.update({
        where: { id: postId },
        data: {
          playersConfirmed: Math.max(0, playRequest.post.playersConfirmed - 1),
          isComplete: false,
        },
      }),
    ]);

    // Send a message to the post author with the shared post card
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true },
    });
    await prisma.message.create({
      data: {
        content: note?.trim()
          ? `${user?.name || "A player"} withdrew from your game: "${note.trim()}"`
          : `${user?.name || "A player"} withdrew from your game`,
        senderId: session.user.id,
        receiverId: playRequest.post.authorId,
        sharedPostId: postId,
      },
    });

    return NextResponse.json({ action: "withdrawn" });
  }

  return NextResponse.json({ error: "Cannot cancel this request" }, { status: 400 });
}
