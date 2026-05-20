import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { hasRole, ROLE } from "@/lib/groupRoles";

// PATCH { isClosed?: boolean } — close (or reopen) a poll. Allowed for the
// poll creator OR a team CAPTAIN+ on the poll's team.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ pollId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { pollId } = await params;

  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    include: { message: { select: { groupId: true } } },
  });
  if (!poll || !poll.message) {
    return NextResponse.json({ error: "Poll not found" }, { status: 404 });
  }

  const isOwnPoll = poll.createdById === session.user.id;
  if (!isOwnPoll && !(await hasRole(poll.message.groupId, session.user.id, ROLE.CAPTAIN))) {
    return NextResponse.json(
      { error: "Only the poll creator or a captain can manage this poll" },
      { status: 403 }
    );
  }

  const { isClosed } = await request.json();
  if (typeof isClosed !== "boolean") {
    return NextResponse.json({ error: "isClosed boolean required" }, { status: 400 });
  }

  const updated = await prisma.poll.update({
    where: { id: pollId },
    data: { isClosed },
  });
  return NextResponse.json({ id: updated.id, isClosed: updated.isClosed });
}
