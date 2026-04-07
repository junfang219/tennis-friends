import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// GET notifications for current user
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const notifications = await prisma.notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      actor: { select: { id: true, name: true, profileImageUrl: true } },
    },
  });

  const unreadCount = await prisma.notification.count({
    where: { userId: session.user.id, read: false },
  });

  return NextResponse.json({ notifications, unreadCount });
}

// POST mark notifications as read
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ids } = await request.json().catch(() => ({ ids: undefined }));

  if (ids && Array.isArray(ids)) {
    // Mark specific notifications as read
    await prisma.notification.updateMany({
      where: { id: { in: ids }, userId: session.user.id },
      data: { read: true },
    });
  } else {
    // Mark all as read
    await prisma.notification.updateMany({
      where: { userId: session.user.id, read: false },
      data: { read: true },
    });
  }

  return NextResponse.json({ success: true });
}
