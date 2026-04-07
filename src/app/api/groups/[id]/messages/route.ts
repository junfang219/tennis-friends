import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

async function verifyMembership(userId: string, groupId: string) {
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  return !!membership;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  if (!(await verifyMembership(session.user.id, id))) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const messages = await prisma.groupMessage.findMany({
    where: { groupId: id },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: {
      sender: { select: { id: true, name: true, profileImageUrl: true } },
    },
  });

  return NextResponse.json(messages);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  if (!(await verifyMembership(session.user.id, id))) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const { content } = await request.json();

  if (!content?.trim()) {
    return NextResponse.json({ error: "Content required" }, { status: 400 });
  }

  const message = await prisma.groupMessage.create({
    data: {
      content: content.trim(),
      groupId: id,
      senderId: session.user.id,
    },
    include: {
      sender: { select: { id: true, name: true, profileImageUrl: true } },
    },
  });

  return NextResponse.json(message);
}
