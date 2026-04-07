import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { postId } = await request.json();

  if (!postId) {
    return NextResponse.json({ error: "Post ID required" }, { status: 400 });
  }

  await prisma.hiddenPost.upsert({
    where: { userId_postId: { userId: session.user.id, postId } },
    update: {},
    create: { userId: session.user.id, postId },
  });

  return NextResponse.json({ success: true });
}
