import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ensureSessionChat } from "@/lib/sessionChat";
import { ensureTeamGroup } from "@/lib/teamGroup";
import { emitToUser } from "@/lib/eventBus";

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
    include: { post: { include: { author: { select: { id: true, name: true } } } } },
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
    emitToUser(playRequest.userId, { kind: "notifications" });

    // When the session just filled up AND it's a find-players post, spin up a
    // group chat with the author + every approved player. Idempotent helper
    // also covers re-trigger paths (manual fill via PATCH).
    let sessionChatId: string | null = null;
    let teamGroupId: string | null = null;
    if (isNowComplete && playRequest.post.postType === "find_players") {
      try {
        sessionChatId = await ensureSessionChat(playRequest.postId);
      } catch (err) {
        console.error("ensureSessionChat (respond) failed:", err);
      }
    }
    // When a propose_team post just filled up, auto-create a Team (Group)
    // owned by the post author with all approved players as members. The
    // returned id powers the "View team" link on the collapsed post card.
    if (isNowComplete && playRequest.post.postType === "propose_team") {
      try {
        teamGroupId = await ensureTeamGroup(playRequest.postId);
      } catch (err) {
        console.error("ensureTeamGroup (respond) failed:", err);
      }
    }

    return NextResponse.json({ status: "APPROVED", isComplete: isNowComplete, sessionChatId, teamGroupId });
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
    emitToUser(playRequest.userId, { kind: "notifications" });

    return NextResponse.json({ status: "REJECTED" });
  }
}
