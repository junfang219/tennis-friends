import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const { searchParams } = new URL(request.url);
  const groupId = searchParams.get("groupId"); // optional filter

  // Get groups user is in
  const userGroups = await prisma.groupMember.findMany({
    where: { userId },
    include: { group: { select: { id: true, name: true } } },
  });
  const userGroupIds = userGroups.map((m) => m.groupId);

  // Build filter for find_players posts
  const postWhere: Record<string, unknown> = {
    postType: "find_players",
    OR: [
      // Posts I created
      { authorId: userId },
      // Posts I was approved for
      { playRequests: { some: { userId, status: "APPROVED" } } },
      // Posts from friends/groups visible to me (that are still open or I might want to join)
    ],
  };

  // If filtering by group
  if (groupId) {
    postWhere.postGroups = { some: { groupId } };
  }

  const posts = await prisma.post.findMany({
    where: postWhere,
    orderBy: { playDate: "asc" },
    include: {
      author: { select: { id: true, name: true, profileImageUrl: true } },
      postGroups: {
        include: { group: { select: { id: true, name: true } } },
      },
      playRequests: {
        where: { userId },
        select: { status: true },
        take: 1,
      },
    },
  });

  const events = posts.map((post) => {
    let role: "creator" | "player" | "none" = "none";
    if (post.authorId === userId) role = "creator";
    else if (post.playRequests[0]?.status === "APPROVED") role = "player";

    return {
      id: post.id,
      playDate: post.playDate,
      playTime: post.playTime,
      playDuration: post.playDuration,
      courtLocation: post.courtLocation,
      gameType: post.gameType,
      playersNeeded: post.playersNeeded,
      playersConfirmed: post.playersConfirmed,
      courtBooked: post.courtBooked,
      isComplete: post.isComplete,
      content: post.content,
      role,
      author: post.author,
      groups: post.postGroups.map((pg) => ({ id: pg.group.id, name: pg.group.name })),
    };
  });

  return NextResponse.json({
    events,
    userGroups: userGroups.map((m) => m.group),
  });
}
