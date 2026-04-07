import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") || "";

  const users = await prisma.user.findMany({
    where: {
      AND: [
        { id: { not: session.user.id } },
        q ? { name: { contains: q } } : {},
      ],
    },
    select: {
      id: true,
      name: true,
      skillLevel: true,
      favoriteSurface: true,
      profileImageUrl: true,
      bio: true,
    },
    take: 20,
  });

  // Get friendship status for each user
  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [
        { requesterId: session.user.id, addresseeId: { in: users.map((u) => u.id) } },
        { addresseeId: session.user.id, requesterId: { in: users.map((u) => u.id) } },
      ],
    },
  });

  const usersWithStatus = users.map((user) => {
    const friendship = friendships.find(
      (f) =>
        (f.requesterId === session.user!.id && f.addresseeId === user.id) ||
        (f.addresseeId === session.user!.id && f.requesterId === user.id)
    );
    return {
      ...user,
      friendshipId: friendship?.id || null,
      friendshipStatus: friendship?.status || null,
      isRequester: friendship?.requesterId === session.user!.id,
    };
  });

  return NextResponse.json(usersWithStatus);
}
