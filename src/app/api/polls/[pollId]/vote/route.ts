import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getMemberRole } from "@/lib/groupRoles";

// POST { optionIds: string[] } — cast/replace this user's votes for the
// poll. For single-vote polls, optionIds must be exactly one. For multi
// polls, any subset (including empty = retract). Atomic: deletes the
// user's existing rows for this poll and inserts the new ones in one tx.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ pollId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { pollId } = await params;

  // Resolve the poll → group membership via the backing message.
  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    include: {
      message: { select: { groupId: true } },
      options: { select: { id: true } },
    },
  });
  if (!poll || !poll.message) {
    return NextResponse.json({ error: "Poll not found" }, { status: 404 });
  }
  if (poll.isClosed) {
    return NextResponse.json({ error: "Poll is closed" }, { status: 410 });
  }

  if ((await getMemberRole(poll.message.groupId, session.user.id)) === null) {
    return NextResponse.json({ error: "Not a member of this team" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const optionIds = (body && typeof body === "object" ? (body as { optionIds?: unknown }).optionIds : null) as unknown;
  if (!Array.isArray(optionIds)) {
    return NextResponse.json({ error: "optionIds array required" }, { status: 400 });
  }

  const validIds = new Set(poll.options.map((o) => o.id));
  const filtered = (optionIds as unknown[])
    .filter((id): id is string => typeof id === "string" && validIds.has(id));
  const deduped = Array.from(new Set(filtered));

  if (!poll.isMulti && deduped.length > 1) {
    return NextResponse.json({ error: "This poll only accepts one vote" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.pollVote.deleteMany({
      where: { pollId, userId: session.user!.id },
    });
    if (deduped.length > 0) {
      await tx.pollVote.createMany({
        data: deduped.map((optionId) => ({ pollId, optionId, userId: session.user!.id })),
      });
    }
  });

  return NextResponse.json({ pollId, myOptionIds: deduped });
}
