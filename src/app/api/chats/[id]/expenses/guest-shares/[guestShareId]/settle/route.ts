import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; guestShareId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: chatId, guestShareId } = await params;
  const userId = session.user.id;

  const body = await request.json().catch(() => ({}));
  const settled = body.settled === true;

  const share = await prisma.guestExpenseShare.findUnique({
    where: { id: guestShareId },
    include: {
      expense: { select: { chatId: true, payerId: true } },
    },
  });
  if (!share || share.expense.chatId !== chatId) {
    return NextResponse.json({ error: "Share not found" }, { status: 404 });
  }
  // Only the payer of the parent expense can mark a guest's share paid —
  // they're the one collecting in person.
  if (share.expense.payerId !== userId) {
    return NextResponse.json({ error: "Only the payer can settle a guest share" }, { status: 403 });
  }

  await prisma.guestExpenseShare.update({
    where: { id: guestShareId },
    data: { settledAt: settled ? new Date() : null },
  });

  return NextResponse.json({ ok: true, settled });
}
