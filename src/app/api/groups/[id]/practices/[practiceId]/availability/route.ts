import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { normalizePracticeStatus, RSVP } from "@/lib/rsvpStatus";

// Unified vocab only — practice gains "maybe" as a new option versus the old
// im_in/not_available pair. Legacy values are still tolerated by the
// normalizer so any stale clients can finish their RSVP.
const ALLOWED_STATUS: readonly string[] = [RSVP.PLAYING, RSVP.MAYBE, RSVP.NOT_PLAYING];

// PUT upsert the current user's availability for a practice
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; practiceId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, practiceId } = await params;
  const userId = session.user.id;

  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: id, userId } },
  });
  if (!member) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const practice = await prisma.teamPractice.findUnique({
    where: { id: practiceId },
    include: { series: true },
  });
  if (!practice || practice.series.groupId !== id) {
    return NextResponse.json({ error: "Practice not found in this team" }, { status: 404 });
  }

  const { status } = await request.json();
  if (typeof status !== "string" || !ALLOWED_STATUS.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const normalized = normalizePracticeStatus(status);

  const upserted = await prisma.practiceAvailability.upsert({
    where: { practiceId_userId: { practiceId, userId } },
    update: { status: normalized },
    create: { practiceId, userId, status: normalized },
    include: {
      user: { select: { id: true, name: true, profileImageUrl: true } },
    },
  });

  return NextResponse.json(upserted);
}
