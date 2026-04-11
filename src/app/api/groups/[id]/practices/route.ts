import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

async function verifyMembership(userId: string, groupId: string) {
  const m = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  return !!m;
}

const REPEAT_OPTIONS = ["", "weekly", "biweekly", "monthly"];

// GET all practices for a team (any member)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!(await verifyMembership(session.user.id, id))) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const practices = await prisma.teamPractice.findMany({
    where: { groupId: id },
    orderBy: [{ practiceDate: "asc" }, { practiceTime: "asc" }],
    include: {
      creator: { select: { id: true, name: true, profileImageUrl: true } },
    },
  });

  return NextResponse.json(practices);
}

// POST create a new practice (any member)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const userId = session.user.id;

  if (!(await verifyMembership(userId, id))) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const { practiceDate, practiceTime, location, playersNeeded, coach, repeats, repeatUntil, notes } =
    await request.json();

  if (!practiceDate || typeof practiceDate !== "string") {
    return NextResponse.json({ error: "practiceDate is required" }, { status: 400 });
  }
  if (!location || typeof location !== "string" || !location.trim()) {
    return NextResponse.json({ error: "location is required" }, { status: 400 });
  }

  const repeatsVal = typeof repeats === "string" && REPEAT_OPTIONS.includes(repeats) ? repeats : "";
  const playersNeededInt = Number.isInteger(playersNeeded) ? playersNeeded : parseInt(playersNeeded) || 0;
  const cleanCoach = typeof coach === "string" ? coach.trim() : "";
  const cleanNotes = typeof notes === "string" ? notes.trim() : "";
  const cleanLocation = location.trim();
  const cleanTime = typeof practiceTime === "string" ? practiceTime : "";

  // For a repeated practice, expand into one occurrence per cadence between the start
  // date and the end date (inclusive). For one-time, we just create the single date.
  if (repeatsVal && (!repeatUntil || typeof repeatUntil !== "string")) {
    return NextResponse.json(
      { error: "repeatUntil is required for repeating practices" },
      { status: 400 }
    );
  }
  if (repeatsVal && repeatUntil < practiceDate) {
    return NextResponse.json(
      { error: "repeatUntil must be on or after the start date" },
      { status: 400 }
    );
  }

  // Build the list of dates to create
  const dates: string[] = [];
  if (!repeatsVal) {
    dates.push(practiceDate);
  } else {
    // Parse start as a local date (YYYY-MM-DD) — append T00:00 to avoid TZ issues
    const start = new Date(`${practiceDate}T00:00`);
    const end = new Date(`${repeatUntil}T00:00`);
    let cursor = new Date(start);
    let safety = 0;
    while (cursor <= end && safety < 200) {
      const yyyy = cursor.getFullYear();
      const mm = String(cursor.getMonth() + 1).padStart(2, "0");
      const dd = String(cursor.getDate()).padStart(2, "0");
      dates.push(`${yyyy}-${mm}-${dd}`);
      // Advance the cursor
      if (repeatsVal === "weekly") cursor.setDate(cursor.getDate() + 7);
      else if (repeatsVal === "biweekly") cursor.setDate(cursor.getDate() + 14);
      else if (repeatsVal === "monthly") cursor.setMonth(cursor.getMonth() + 1);
      else break;
      safety++;
    }
    if (dates.length === 0) {
      return NextResponse.json(
        { error: "No practice dates produced — check the start and end dates" },
        { status: 400 }
      );
    }
    if (dates.length > 52) {
      return NextResponse.json(
        { error: "Too many occurrences (max 52). Please shorten the date range." },
        { status: 400 }
      );
    }
  }

  // Build a friendly post body that surfaces practice-specific details
  const REPEAT_LABELS: Record<string, string> = {
    weekly: "🔁 Weekly",
    biweekly: "🔁 Every 2 weeks",
    monthly: "🔁 Monthly",
  };
  const baseLines: string[] = ["🎾 Team Practice"];
  if (cleanCoach) baseLines.push(`👨‍🏫 Coach: ${cleanCoach}`);
  if (repeatsVal && REPEAT_LABELS[repeatsVal]) baseLines.push(REPEAT_LABELS[repeatsVal]);
  if (cleanNotes) baseLines.push(cleanNotes);
  const postContent = baseLines.join("\n");

  // Create one Post + TeamPractice per occurrence date.
  const created: { id: string }[] = [];
  for (const date of dates) {
    const post = await prisma.post.create({
      data: {
        content: postContent,
        postType: "find_players",
        playDate: date,
        playTime: cleanTime,
        courtLocation: cleanLocation,
        gameType: "practice",
        playersNeeded: Math.max(0, playersNeededInt),
        authorId: userId,
        postGroups: { create: [{ groupId: id }] },
      },
    });

    const practice = await prisma.teamPractice.create({
      data: {
        groupId: id,
        creatorId: userId,
        postId: post.id,
        practiceDate: date,
        practiceTime: cleanTime,
        location: cleanLocation,
        playersNeeded: Math.max(0, playersNeededInt),
        coach: cleanCoach,
        repeats: repeatsVal,
        notes: cleanNotes,
      },
    });
    created.push({ id: practice.id });
  }

  return NextResponse.json({ count: created.length });
}
