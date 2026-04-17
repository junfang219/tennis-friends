import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// Parse "YYYY-MM-DD" + "HH:MM" (24h) into a local Date; undefined on failure.
function parsePlayDateTime(date: string, time: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  if (!/^\d{2}:\d{2}$/.test(time)) return undefined;
  const d = new Date(`${date}T${time}:00`);
  return isNaN(d.getTime()) ? undefined : d;
}

function formatShortDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date || "TBD";
  const d = new Date(`${date}T12:00:00`);
  if (isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function format12h(time: string): string {
  if (!/^\d{2}:\d{2}$/.test(time)) return time || "TBD";
  const [hStr, mStr] = time.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr.padStart(2, "0")} ${period}`;
}

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

    // When the session just filled up AND it's a find-players post, spin up a
    // group chat with the author + every approved player, with a templated
    // reminder message. Wrapped in try/catch so approval still succeeds if
    // anything here fails — the chat is a follow-on effect, not part of the
    // approval contract. sessionChatId is returned to the client so the card
    // can collapse to its compact form and link directly into the new chat.
    let sessionChatId: string | null = null;
    if (isNowComplete && playRequest.post.postType === "find_players") {
      try {
        const post = playRequest.post;
        const approved = await prisma.playRequest.findMany({
          where: { postId: post.id, status: "APPROVED" },
          include: { user: { select: { id: true, name: true } } },
        });
        const memberIds = new Set<string>([post.authorId]);
        for (const r of approved) memberIds.add(r.userId);

        const gameStart = parsePlayDateTime(post.playDate, post.playTime);
        const durationMin = post.playDuration || 90;
        const sessionEndAt = gameStart
          ? new Date(gameStart.getTime() + durationMin * 60_000)
          : new Date(Date.now() + 24 * 60 * 60_000); // best-effort fallback

        const shortDate = formatShortDate(post.playDate);
        const time12 = format12h(post.playTime);
        const location = post.courtLocation || "TBD";
        const chatName = `${shortDate} · ${location} · ${time12}`;

        const playerNames = [post.author.name, ...approved.map((r) => r.user.name)].join(", ");
        const body = [
          "🎾 Game confirmed!",
          `📅 ${shortDate}${gameStart ? ` at ${time12}` : ""} (${durationMin} min)`,
          `📍 ${location}`,
          `Players: ${playerNames}`,
          "",
          "See you on court!",
        ].join("\n");

        const chat = await prisma.chat.create({
          data: {
            name: chatName,
            creatorId: post.authorId,
            postId: post.id,
            sessionEndAt,
          },
        });
        await prisma.chatParticipant.createMany({
          data: Array.from(memberIds).map((uid) => ({ chatId: chat.id, userId: uid })),
        });
        await prisma.chatMessage.create({
          data: {
            chatId: chat.id,
            senderId: post.authorId,
            content: body,
          },
        });
        sessionChatId = chat.id;
      } catch (err) {
        console.error("Failed to auto-create session chat:", err);
      }
    }

    return NextResponse.json({ status: "APPROVED", isComplete: isNowComplete, sessionChatId });
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
