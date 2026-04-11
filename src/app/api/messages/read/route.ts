import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// POST mark a 1:1 conversation as read by upserting the user's lastReadAt for that other party
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { otherId } = await request.json();
  if (!otherId || typeof otherId !== "string") {
    return NextResponse.json({ error: "otherId required" }, { status: 400 });
  }

  await prisma.directMessageRead.upsert({
    where: { userId_otherId: { userId: session.user.id, otherId } },
    update: { lastReadAt: new Date() },
    create: { userId: session.user.id, otherId, lastReadAt: new Date() },
  });

  return NextResponse.json({ success: true });
}
