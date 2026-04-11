import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// PATCH cancel/uncancel a practice (creator only)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; practiceId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, practiceId } = await params;
  const userId = session.user.id;

  const practice = await prisma.teamPractice.findUnique({ where: { id: practiceId } });
  if (!practice || practice.groupId !== id) {
    return NextResponse.json({ error: "Practice not found in this team" }, { status: 404 });
  }
  if (practice.creatorId !== userId) {
    return NextResponse.json({ error: "Only the creator can modify this practice" }, { status: 403 });
  }

  const { cancelled } = await request.json();
  if (typeof cancelled !== "boolean") {
    return NextResponse.json({ error: "cancelled boolean required" }, { status: 400 });
  }

  const updated = await prisma.teamPractice.update({
    where: { id: practiceId },
    data: { cancelled },
    include: {
      creator: { select: { id: true, name: true, profileImageUrl: true } },
    },
  });

  // Lock the linked find_players Post when cancelled (no new join requests)
  if (practice.postId) {
    await prisma.post.update({
      where: { id: practice.postId },
      data: { isComplete: cancelled },
    }).catch(() => {});
  }

  return NextResponse.json(updated);
}

// DELETE the practice entirely (creator only)
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; practiceId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, practiceId } = await params;
  const userId = session.user.id;

  const practice = await prisma.teamPractice.findUnique({ where: { id: practiceId } });
  if (!practice || practice.groupId !== id) {
    return NextResponse.json({ error: "Practice not found in this team" }, { status: 404 });
  }
  if (practice.creatorId !== userId) {
    return NextResponse.json({ error: "Only the creator can delete this practice" }, { status: 403 });
  }

  await prisma.teamPractice.delete({ where: { id: practiceId } });

  // Also delete the linked Post (cascades PostGroup link, likes, comments, playRequests)
  if (practice.postId) {
    await prisma.post.delete({ where: { id: practice.postId } }).catch(() => {});
  }

  return NextResponse.json({ success: true });
}
