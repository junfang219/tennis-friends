import { prisma } from "./prisma";

function parsePlayDateTime(playDate: string, playTime: string): Date | null {
  if (!playDate) return null;
  const t = playTime || "12:00";
  const [hStr, mStr] = t.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const d = new Date(`${playDate}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
  if (isNaN(d.getTime())) return null;
  return d;
}

function formatShortDate(playDate: string): string {
  if (!playDate) return "TBD";
  const d = new Date(`${playDate}T12:00:00`);
  if (isNaN(d.getTime())) return playDate;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function format12h(playTime: string): string {
  if (!playTime || !playTime.includes(":")) return playTime || "TBD";
  const [hStr, mStr] = playTime.split(":");
  let h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return playTime;
  const am = h < 12;
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${String(m).padStart(2, "0")} ${am ? "AM" : "PM"}`;
}

function manualNames(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.split(",").map((n) => n.trim()).filter((n) => n.length > 0);
}

/**
 * Ensure a session chat exists for a complete find_players post.
 * Idempotent — returns existing chat id if one is already linked.
 * Creates the chat with author + approved players as participants and
 * copies the post's manual-player names onto Chat.manualPlayerNames.
 */
export async function ensureSessionChat(postId: string): Promise<string | null> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: {
      author: { select: { id: true, name: true } },
      playRequests: {
        where: { status: "APPROVED" },
        include: { user: { select: { id: true, name: true } } },
      },
    },
  });
  if (!post) return null;
  if (post.postType !== "find_players") return null;
  if (!post.isComplete) return null;

  const existing = await prisma.chat.findFirst({
    where: { postId },
    select: { id: true },
  });
  if (existing) return existing.id;

  const guests = manualNames(post.manualPlayers);
  const memberIds = new Set<string>([post.authorId]);
  for (const r of post.playRequests) memberIds.add(r.userId);

  const gameStart = parsePlayDateTime(post.playDate, post.playTime);
  const durationMin = post.playDuration || 90;
  const sessionEndAt = gameStart
    ? new Date(gameStart.getTime() + durationMin * 60_000)
    : new Date(Date.now() + 24 * 60 * 60_000);

  const shortDate = formatShortDate(post.playDate);
  const time12 = format12h(post.playTime);
  const location = post.courtLocation || "TBD";
  const chatName = `${shortDate} · ${location} · ${time12}`;

  const playerNames = [
    post.author.name,
    ...post.playRequests.map((r) => r.user.name),
    ...guests.map((g) => `${g} (guest)`),
  ].join(", ");

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
      manualPlayerNames: post.manualPlayers || "",
    },
  });
  await prisma.chatParticipant.createMany({
    data: Array.from(memberIds).map((uid) => ({ chatId: chat.id, userId: uid })),
  });
  await prisma.chatMessage.create({
    data: { chatId: chat.id, senderId: post.authorId, content: body },
  });

  return chat.id;
}
