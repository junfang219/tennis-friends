import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { resolveFacilityByName } from "@/lib/facilities";

const ELIGIBLE_CATEGORIES = new Set(["public_park", "school", "college"]);

const WINDOW_BEFORE_MS = 30 * 60 * 1000;
const LOOKAHEAD_MS = 4 * 60 * 60 * 1000;

type UpcomingGame = {
  postId: string;
  startTime: string;
  endTime: string;
  courtId: string;
  venueName: string;
  venueLat: number;
  venueLng: number;
};

function parseStart(playDate: string, playTime: string): Date | null {
  if (!playDate || !playTime) return null;
  const d = new Date(`${playDate}T${playTime}:00`);
  return isNaN(d.getTime()) ? null : d;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const now = new Date();
  const cutoff = new Date(now.getTime() + LOOKAHEAD_MS);
  // playDate is a YYYY-MM-DD string in the user's local timezone.
  // Use yesterday's UTC date as a safety buffer so we never miss "today PDT"
  // when UTC has already advanced past midnight. The per-post end-time check
  // below filters out anything actually expired.
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const posts = await prisma.post.findMany({
    where: {
      postType: "find_players",
      isComplete: false,
      playDate: { gte: yesterday },
      OR: [
        { authorId: userId },
        { playRequests: { some: { userId, status: "APPROVED" } } },
      ],
    },
    select: {
      id: true,
      playDate: true,
      playTime: true,
      playDuration: true,
      courtLocation: true,
    },
  });

  const games: UpcomingGame[] = [];
  for (const p of posts) {
    const start = parseStart(p.playDate, p.playTime);
    if (!start) continue;
    const end = new Date(start.getTime() + (p.playDuration || 90) * 60 * 1000);
    if (end.getTime() <= now.getTime()) continue;
    if (start.getTime() - WINDOW_BEFORE_MS > cutoff.getTime()) continue;
    if (!p.courtLocation.trim()) continue;
    const facility = resolveFacilityByName(p.courtLocation);
    if (!facility) continue;
    if (!ELIGIBLE_CATEGORIES.has(facility.category)) continue;
    if (facility.latitude == null || facility.longitude == null) continue;
    games.push({
      postId: p.id,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      courtId: facility.courtId,
      venueName: facility.name,
      venueLat: facility.latitude,
      venueLng: facility.longitude,
    });
  }

  return NextResponse.json({ games });
}
