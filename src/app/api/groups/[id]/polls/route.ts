import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getMemberRole } from "@/lib/groupRoles";
import { emitToUsers } from "@/lib/eventBus";
import { pushToUsers } from "@/lib/push";

const MAX_QUESTION = 200;
const MAX_OPTION = 80;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 8;

// POST — create a poll. Any member of the team can start one. Creates a
// Poll, its options, and a backing GroupMessage atomically so the chat
// timeline immediately surfaces the new poll card.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if ((await getMemberRole(id, session.user.id)) === null) {
    return NextResponse.json({ error: "Not a member of this team" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const { question: rawQuestion, options: rawOptions, isMulti } = body as {
    question?: unknown;
    options?: unknown;
    isMulti?: unknown;
  };

  if (typeof rawQuestion !== "string" || !rawQuestion.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }
  const question = rawQuestion.trim().slice(0, MAX_QUESTION);

  if (!Array.isArray(rawOptions)) {
    return NextResponse.json({ error: "options must be an array" }, { status: 400 });
  }
  const optionTexts = rawOptions
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => t.slice(0, MAX_OPTION));

  if (optionTexts.length < MIN_OPTIONS) {
    return NextResponse.json({ error: `At least ${MIN_OPTIONS} options required` }, { status: 400 });
  }
  if (optionTexts.length > MAX_OPTIONS) {
    return NextResponse.json({ error: `At most ${MAX_OPTIONS} options allowed` }, { status: 400 });
  }
  // Reject duplicate option texts within the poll — a duplicate vote target
  // is almost always a typo, and would split votes confusingly.
  if (new Set(optionTexts).size !== optionTexts.length) {
    return NextResponse.json({ error: "Options must be unique" }, { status: 400 });
  }

  const { poll, message } = await prisma.$transaction(async (tx) => {
    const poll = await tx.poll.create({
      data: {
        question,
        isMulti: isMulti === true,
        createdById: session.user.id,
        options: {
          create: optionTexts.map((text, i) => ({ text, order: i })),
        },
      },
      include: { options: { orderBy: { order: "asc" } } },
    });
    const message = await tx.groupMessage.create({
      data: {
        content: question, // duplicated so chat fallback rendering still has something
        groupId: id,
        senderId: session.user.id,
        kind: "chat",
        pollId: poll.id,
      },
      include: { sender: { select: { id: true, name: true, profileImageUrl: true } } },
    });
    return { poll, message };
  });

  // Fan-out inbox + push the same way regular chat does.
  const members = await prisma.groupMember.findMany({
    where: { groupId: id, userId: { not: session.user.id }, muted: false },
    select: { userId: true },
  });
  const memberIds = members.map((m) => m.userId);
  emitToUsers(memberIds, { kind: "inbox" });
  const groupName = await prisma.group.findUnique({ where: { id }, select: { name: true } });
  void pushToUsers(memberIds, {
    title: groupName?.name || "Group",
    body: `${message.sender.name} started a poll: ${question.slice(0, 80)}`,
    threadId: `group:${id}`,
    data: { kind: "group", groupId: id },
  });

  return NextResponse.json({
    id: message.id,
    content: message.content,
    mediaUrl: "",
    mediaType: "",
    senderId: message.senderId,
    sharedPostId: null,
    sharedPost: null,
    kind: message.kind,
    notifyEmail: message.notifyEmail,
    pinnedAt: message.pinnedAt,
    pollId: message.pollId,
    poll: {
      id: poll.id,
      question: poll.question,
      isMulti: poll.isMulti,
      isClosed: poll.isClosed,
      createdById: poll.createdById,
      options: poll.options.map((o) => ({ id: o.id, text: o.text, order: o.order, voteCount: 0 })),
      myOptionIds: [],
      totalVotes: 0,
    },
    createdAt: message.createdAt,
    sender: message.sender,
    reactions: [],
  });
}
