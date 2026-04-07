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

  const comments = await prisma.comment.findMany({
    where: { postId },
    orderBy: { createdAt: "asc" },
    include: {
      author: { select: { id: true, name: true, profileImageUrl: true } },
    },
  });

  return NextResponse.json(comments);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { postId, content } = await request.json();

  if (!postId || !content?.trim()) {
    return NextResponse.json({ error: "Post ID and content required" }, { status: 400 });
  }

  const comment = await prisma.comment.create({
    data: {
      content: content.trim(),
      postId,
      authorId: session.user.id,
    },
    include: {
      author: { select: { id: true, name: true, profileImageUrl: true } },
    },
  });

  // Notify post author (unless commenting on own post)
  const post = await prisma.post.findUnique({ where: { id: postId }, select: { authorId: true } });
  if (post && post.authorId !== session.user.id) {
    await prisma.notification.create({
      data: {
        userId: post.authorId,
        actorId: session.user.id,
        type: "comment",
        postId,
        commentId: comment.id,
      },
    });
  }

  // Notify other commenters on the same post (excluding the current user and the post author)
  const otherCommenters = await prisma.comment.findMany({
    where: {
      postId,
      authorId: { notIn: [session.user.id, post?.authorId || ""] },
    },
    select: { authorId: true },
    distinct: ["authorId"],
  });
  for (const c of otherCommenters) {
    await prisma.notification.create({
      data: {
        userId: c.authorId,
        actorId: session.user.id,
        type: "reply",
        postId,
        commentId: comment.id,
      },
    });
  }

  return NextResponse.json(comment);
}
