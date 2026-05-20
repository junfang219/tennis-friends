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

  // Get groups user is in (non-archived only — archived teams shouldn't appear
  // in the filter dropdown or contribute team events to the calendar).
  const userGroups = await prisma.groupMember.findMany({
    where: { userId, archivedAt: null },
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

  // Team matches: include every match for the teams the user is in (filtered by groupId
  // if the dropdown is active). Honor the dropdown only if the picked group is in the
  // user's non-archived membership list — otherwise treat as no filter.
  const teamGroupFilter =
    groupId && userGroupIds.includes(groupId) ? [groupId] : userGroupIds;
  const teamMatches = teamGroupFilter.length
    ? await prisma.teamMatch.findMany({
        where: { groupId: { in: teamGroupFilter } },
        include: {
          availabilities: {
            where: { userId },
            select: { lineupSlot: true },
            take: 1,
          },
          group: { select: { id: true, name: true } },
        },
        orderBy: [{ matchDate: "asc" }, { matchTime: "asc" }],
      })
    : [];

  const matches = teamMatches.map((m) => {
    const slot = m.availabilities[0]?.lineupSlot || "";
    return {
      id: m.id,
      teamId: m.groupId,
      teamName: m.group.name,
      matchDate: m.matchDate,
      matchTime: m.matchTime,
      location: m.location,
      notes: m.notes,
      inLineup: !!slot.trim(),
      lineupSlot: slot,
    };
  });

  // Practices: only ones the user is playing, scoped to teams (and active group filter).
  const myPracticeAvails = teamGroupFilter.length
    ? await prisma.practiceAvailability.findMany({
        where: {
          userId,
          status: "playing",
          practice: {
            series: { groupId: { in: teamGroupFilter } },
          },
        },
        include: {
          practice: {
            include: {
              series: {
                include: { group: { select: { id: true, name: true } } },
              },
            },
          },
        },
      })
    : [];

  const practices = myPracticeAvails
    .map((a) => {
      const p = a.practice;
      const s = p.series;
      return {
        id: p.id,
        teamId: s.groupId,
        teamName: s.group.name,
        seriesId: s.id,
        seriesName: s.name,
        practiceDate: p.practiceDate,
        practiceTime: s.practiceTime,
        location: s.location,
        notes: s.notes,
      };
    })
    .sort((a, b) =>
      (a.practiceDate + a.practiceTime).localeCompare(b.practiceDate + b.practiceTime)
    );

  return NextResponse.json({
    events,
    matches,
    practices,
    userGroups: userGroups.map((m) => m.group),
  });
}
