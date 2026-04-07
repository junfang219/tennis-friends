import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { addresseeId } = await request.json();

  if (addresseeId === session.user.id) {
    return NextResponse.json({ error: "Cannot friend yourself" }, { status: 400 });
  }

  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: session.user.id, addresseeId },
        { requesterId: addresseeId, addresseeId: session.user.id },
      ],
    },
  });

  if (existing) {
    return NextResponse.json({ error: "Friendship already exists" }, { status: 400 });
  }

  const friendship = await prisma.friendship.create({
    data: { requesterId: session.user.id, addresseeId, status: "PENDING" },
  });

  return NextResponse.json(friendship);
}
