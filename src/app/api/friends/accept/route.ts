import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { friendshipId } = await request.json();

  const friendship = await prisma.friendship.findUnique({ where: { id: friendshipId } });

  if (!friendship || friendship.addresseeId !== session.user.id || friendship.status !== "PENDING") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const updated = await prisma.friendship.update({
    where: { id: friendshipId },
    data: { status: "ACCEPTED" },
  });

  return NextResponse.json(updated);
}
