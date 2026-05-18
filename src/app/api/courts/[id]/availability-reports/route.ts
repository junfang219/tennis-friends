import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getFacilityByCourtId, resolveFacilityByName } from "@/lib/facilities";
import {
  ipFor,
  checkAvailabilityReportRateLimit,
} from "@/lib/availabilityReportRateLimit";

const ELIGIBLE_CATEGORIES = new Set(["public_park", "school", "college"]);
const WINDOW_BEFORE_MS = 30 * 60 * 1000;
const DEDUPE_WINDOW_MS = 30 * 60 * 1000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id: courtId } = await params;

  if (!courtId.trim()) {
    return NextResponse.json({ error: "Missing courtId" }, { status: 400 });
  }

  let body: { hasEmpty?: unknown; postId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.hasEmpty !== "boolean") {
    return NextResponse.json({ error: "hasEmpty must be boolean" }, { status: 400 });
  }
  const hasEmpty = body.hasEmpty;
  const postId = typeof body.postId === "string" && body.postId.length > 0 ? body.postId : null;

  const facility = getFacilityByCourtId(courtId);
  if (!facility) {
    return NextResponse.json({ error: "Court not eligible" }, { status: 400 });
  }
  if (!ELIGIBLE_CATEGORIES.has(facility.category)) {
    return NextResponse.json({ error: "Court not eligible" }, { status: 400 });
  }

  if (postId) {
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: {
        authorId: true,
        playDate: true,
        playTime: true,
        playDuration: true,
        courtLocation: true,
        playRequests: { where: { userId }, select: { status: true }, take: 1 },
      },
    });
    if (!post) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 });
    }
    const isParticipant =
      post.authorId === userId ||
      post.playRequests[0]?.status === "APPROVED";
    if (!isParticipant) {
      return NextResponse.json({ error: "Not a participant" }, { status: 403 });
    }
    const start = post.playDate && post.playTime
      ? new Date(`${post.playDate}T${post.playTime}:00`)
      : null;
    if (!start || isNaN(start.getTime())) {
      return NextResponse.json({ error: "Game has no valid start" }, { status: 400 });
    }
    const end = new Date(start.getTime() + (post.playDuration || 90) * 60 * 1000);
    const now = Date.now();
    if (now < start.getTime() - WINDOW_BEFORE_MS || now > end.getTime()) {
      return NextResponse.json({ error: "Outside game window" }, { status: 400 });
    }
    const matchedFacility = resolveFacilityByName(post.courtLocation);
    if (!matchedFacility || matchedFacility.courtId !== courtId) {
      return NextResponse.json({ error: "Court does not match game" }, { status: 400 });
    }
  }

  const dedupeCutoff = new Date(Date.now() - DEDUPE_WINDOW_MS);
  const recent = await prisma.courtAvailabilityReport.findFirst({
    where: { courtId, userId, reportedAt: { gt: dedupeCutoff } },
    select: { id: true },
  });
  if (recent) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  const ip = ipFor(request);
  const rl = checkAvailabilityReportRateLimit(ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  await prisma.courtAvailabilityReport.create({
    data: { courtId, userId, hasEmpty, postId },
  });

  return NextResponse.json({ ok: true });
}
