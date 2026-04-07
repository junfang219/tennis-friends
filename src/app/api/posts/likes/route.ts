import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const postId = searchParams.get("postId");

  if (!postId) {
    return NextResponse.json({ error: "Missing postId" }, { status: 400 });
  }

  const likes = await prisma.like.findMany({
    where: { postId },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { id: true, name: true, profileImageUrl: true, skillLevel: true } },
    },
  });

  return NextResponse.json(likes.map((l) => l.user));
}
