import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// DELETE a single practice column (captain only)
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; practiceId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, practiceId } = await params;

  const group = await prisma.group.findUnique({ where: { id } });
  if (!group) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  if (group.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Only the team captain can delete practices" }, { status: 403 });
  }

  const practice = await prisma.teamPractice.findUnique({
    where: { id: practiceId },
    include: { series: true },
  });
  if (!practice || practice.series.groupId !== id) {
    return NextResponse.json({ error: "Practice not found in this team" }, { status: 404 });
  }

  await prisma.teamPractice.delete({ where: { id: practiceId } });

  return NextResponse.json({ success: true });
}
