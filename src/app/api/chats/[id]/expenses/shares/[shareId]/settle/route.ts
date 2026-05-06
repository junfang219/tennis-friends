import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; shareId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: chatId, shareId } = await params;
  const userId = session.user.id;

  const body = await request.json().catch(() => ({}));
  const settled = body.settled === true;

  const share = await prisma.expenseShare.findUnique({
    where: { id: shareId },
    include: { expense: { select: { chatId: true } } },
  });
  if (!share || share.expense.chatId !== chatId) {
    return NextResponse.json({ error: "Share not found" }, { status: 404 });
  }
  if (share.userId !== userId) {
    return NextResponse.json({ error: "Not your share" }, { status: 403 });
  }

  await prisma.expenseShare.update({
    where: { id: shareId },
    data: { settledAt: settled ? new Date() : null },
  });

  return NextResponse.json({ ok: true, settled });
}
