import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// POST: Send a join request for a find_players post
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { postId } = await request.json();

  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || (post.postType !== "find_players" && post.postType !== "propose_team")) {
    return NextResponse.json({ error: "Invalid post" }, { status: 400 });
  }

  if (post.authorId === session.user.id) {
    return NextResponse.json({ error: "Cannot join your own post" }, { status: 400 });
  }

  if (post.isComplete) {
    return NextResponse.json({ error: "This game is already full" }, { status: 400 });
  }

  const existing = await prisma.playRequest.findUnique({
    where: { postId_userId: { postId, userId: session.user.id } },
  });

  if (existing) {
    return NextResponse.json({ error: "Already requested" }, { status: 400 });
  }

  const playRequest = await prisma.playRequest.create({
    data: { postId, userId: session.user.id },
    include: {
      user: { select: { id: true, name: true, profileImageUrl: true, skillLevel: true } },
    },
  });

  // Notify post author
  await prisma.notification.create({
    data: {
      userId: post.authorId,
      actorId: session.user.id,
      type: "join_request",
      postId,
    },
  });

  return NextResponse.json(playRequest);
}

// GET: Get requests for a post (only the post author can see)
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

  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || post.authorId !== session.user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const requests = await prisma.playRequest.findMany({
    where: { postId },
    orderBy: { createdAt: "asc" },
    include: {
      user: { select: { id: true, name: true, profileImageUrl: true, skillLevel: true } },
    },
  });

  return NextResponse.json(requests);
}
