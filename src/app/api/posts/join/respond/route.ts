import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// POST: Approve or reject a play request
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { requestId, action, note } = await request.json();

  if (!requestId || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const playRequest = await prisma.playRequest.findUnique({
    where: { id: requestId },
    include: { post: true },
  });

  if (!playRequest || playRequest.post.authorId !== session.user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  if (playRequest.status !== "PENDING") {
    return NextResponse.json({ error: "Already responded" }, { status: 400 });
  }

  if (action === "approve") {
    // Check if post is already complete
    if (playRequest.post.isComplete) {
      return NextResponse.json({ error: "Game is already full" }, { status: 400 });
    }

    const newConfirmed = playRequest.post.playersConfirmed + 1;
    const isNowComplete = newConfirmed >= playRequest.post.playersNeeded;

    await prisma.$transaction([
      prisma.playRequest.update({
        where: { id: requestId },
        data: { status: "APPROVED", note: note || "" },
      }),
      prisma.post.update({
        where: { id: playRequest.postId },
        data: {
          playersConfirmed: newConfirmed,
          isComplete: isNowComplete,
        },
      }),
    ]);

    // Notify the player
    await prisma.notification.create({
      data: {
        userId: playRequest.userId,
        actorId: session.user.id,
        type: "request_approved",
        postId: playRequest.postId,
      },
    });

    return NextResponse.json({ status: "APPROVED", isComplete: isNowComplete });
  } else {
    await prisma.playRequest.update({
      where: { id: requestId },
      data: { status: "REJECTED", note: note || "" },
    });

    // Notify the player
    await prisma.notification.create({
      data: {
        userId: playRequest.userId,
        actorId: session.user.id,
        type: "request_rejected",
        postId: playRequest.postId,
      },
    });

    return NextResponse.json({ status: "REJECTED" });
  }
}
