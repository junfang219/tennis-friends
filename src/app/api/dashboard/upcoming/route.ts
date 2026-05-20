import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const HORIZON_DAYS = 30;

// GET — aggregate the caller's upcoming matches and practices across every
// team they're on, plus a small slice of recent announcements they haven't
// dismissed. Designed to power the new /dashboard view.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  // Resolve every team the caller is in (skip archived; archived teams
  // shouldn't surface upcoming items on the dashboard).
  const memberships = await prisma.groupMember.findMany({
    where: { userId, archivedAt: null },
    select: { groupId: true, lastReadAt: true },
  });
  if (memberships.length === 0) {
    return NextResponse.json({ matches: [], practices: [], announcements: [] });
  }
  const teamIds = memberships.map((m) => m.groupId);

  const today = new Date();
  const todayIso = isoDate(today);
  const horizon = new Date(today.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);
  const horizonIso = isoDate(horizon);

  // Upcoming matches
  const matches = await prisma.teamMatch.findMany({
    where: {
      groupId: { in: teamIds },
      matchDate: { gte: todayIso, lte: horizonIso },
    },
    orderBy: [{ matchDate: "asc" }, { matchTime: "asc" }],
    take: 20,
    include: {
      group: { select: { id: true, name: true, imageUrl: true } },
      availabilities: {
        where: { userId },
        select: { status: true },
      },
    },
  });

  // Upcoming practices
  const practices = await prisma.teamPractice.findMany({
    where: {
      practiceDate: { gte: todayIso, lte: horizonIso },
      series: { groupId: { in: teamIds } },
    },
    orderBy: { practiceDate: "asc" },
    take: 20,
    include: {
      series: {
        include: {
          group: { select: { id: true, name: true, imageUrl: true } },
        },
      },
      availabilities: {
        where: { userId },
        select: { status: true },
      },
    },
  });

  // Announcements posted since the caller's lastReadAt for each team — limit
  // to 10 most recent across all teams.
  const lastReadByTeam = new Map(memberships.map((m) => [m.groupId, m.lastReadAt]));
  const announcementsRaw = await prisma.groupMessage.findMany({
    where: {
      groupId: { in: teamIds },
      kind: "announcement",
      // Anything posted in the last 14 days; client-side we still highlight
      // unread vs read using lastReadAt.
      createdAt: { gte: new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: {
      group: { select: { id: true, name: true, imageUrl: true } },
      sender: { select: { id: true, name: true, profileImageUrl: true } },
    },
  });
  const announcements = announcementsRaw.map((a) => ({
    id: a.id,
    content: a.content,
    createdAt: a.createdAt,
    sender: a.sender,
    group: a.group,
    unread: (lastReadByTeam.get(a.groupId)?.getTime() ?? 0) < a.createdAt.getTime(),
  }));

  return NextResponse.json({
    matches: matches.map((m) => ({
      id: m.id,
      groupId: m.groupId,
      group: m.group,
      matchDate: m.matchDate,
      matchTime: m.matchTime,
      location: m.location,
      opponent: m.opponent,
      homeAway: m.homeAway,
      myRsvp: m.availabilities[0]?.status ?? null,
    })),
    practices: practices.map((p) => ({
      id: p.id,
      seriesId: p.seriesId,
      group: p.series.group,
      seriesName: p.series.name,
      practiceDate: p.practiceDate,
      practiceTime: p.series.practiceTime,
      location: p.series.location,
      myRsvp: p.availabilities[0]?.status ?? null,
    })),
    announcements,
  });
}

function isoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
