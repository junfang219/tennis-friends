import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { hasRole, ROLE } from "@/lib/groupRoles";

async function verifyMembership(userId: string, groupId: string) {
  const m = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  return !!m;
}

const REPEAT_OPTIONS = ["", "weekly", "twice_weekly", "biweekly", "monthly"];
const MAX_OCCURRENCES = 52;

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: "once a week",
  twice_weekly: "twice a week",
  biweekly: "every other week",
  monthly: "once a month",
};

function ymd(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateLabel(iso: string) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function buildAnnouncement(opts: {
  name: string;
  location: string;
  practiceTime: string;
  notes: string;
  dates: string[];
  repeats: string;
}) {
  const { name, location, practiceTime, notes, dates, repeats } = opts;
  const lines: string[] = [];
  lines.push(`📣 New practice scheduled: ${name}`);
  if (dates.length === 1) {
    lines.push(`📅 ${formatDateLabel(dates[0])}`);
  } else {
    const freq = FREQUENCY_LABELS[repeats] || `${dates.length} sessions`;
    lines.push(`📅 Starting ${formatDateLabel(dates[0])} — ${dates.length} sessions, ${freq}`);
  }
  if (practiceTime) lines.push(`🕒 ${practiceTime}`);
  lines.push(`📍 ${location}`);
  if (notes) lines.push(`📝 ${notes}`);
  lines.push("");
  lines.push("Head to the Team Practice tab to mark your availability.");
  return lines.join("\n");
}

// GET all practice series for a team (any member)
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

  const series = await prisma.practiceSeries.findMany({
    where: { groupId: id },
    orderBy: { createdAt: "asc" },
    include: {
      practices: {
        orderBy: [{ practiceDate: "asc" }],
        include: {
          availabilities: {
            include: {
              user: { select: { id: true, name: true, profileImageUrl: true } },
            },
          },
        },
      },
    },
  });

  return NextResponse.json(series);
}

// POST create a new practice series + N practices (captain only)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const group = await prisma.group.findUnique({ where: { id } });
  if (!group) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  if (!(await hasRole(id, session.user.id, ROLE.CAPTAIN))) {
    return NextResponse.json({ error: "Only the team captain can add practices" }, { status: 403 });
  }

  const {
    name,
    practiceDate,
    practiceTime,
    location,
    notes,
    repeats,
    repeatUntil,
    weekdays,
  } = await request.json();

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!practiceDate || typeof practiceDate !== "string") {
    return NextResponse.json({ error: "practiceDate is required" }, { status: 400 });
  }
  if (!location || typeof location !== "string" || !location.trim()) {
    return NextResponse.json({ error: "location is required" }, { status: 400 });
  }

  const repeatsVal = typeof repeats === "string" && REPEAT_OPTIONS.includes(repeats) ? repeats : "";
  const cleanName = name.trim();
  const cleanLocation = location.trim();
  const cleanNotes = typeof notes === "string" ? notes.trim() : "";
  const cleanTime = typeof practiceTime === "string" ? practiceTime : "";

  const dates: string[] = [];
  if (!repeatsVal) {
    dates.push(practiceDate);
  } else {
    if (!repeatUntil || typeof repeatUntil !== "string") {
      return NextResponse.json(
        { error: "repeatUntil is required for repeating practices" },
        { status: 400 }
      );
    }
    if (repeatUntil < practiceDate) {
      return NextResponse.json(
        { error: "repeatUntil must be on or after the start date" },
        { status: 400 }
      );
    }

    const start = new Date(`${practiceDate}T00:00`);
    const end = new Date(`${repeatUntil}T00:00`);

    if (repeatsVal === "twice_weekly") {
      if (
        !Array.isArray(weekdays) ||
        weekdays.length !== 2 ||
        !weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      ) {
        return NextResponse.json(
          { error: "Pick exactly 2 weekdays for twice-a-week practice" },
          { status: 400 }
        );
      }
      const wdSet = new Set<number>(weekdays as number[]);

      const cursor = new Date(start);
      let safety = 0;
      while (!wdSet.has(cursor.getDay()) && cursor <= end && safety < 14) {
        cursor.setDate(cursor.getDate() + 1);
        safety++;
      }

      while (cursor <= end && dates.length <= MAX_OCCURRENCES) {
        if (wdSet.has(cursor.getDay())) {
          dates.push(ymd(cursor));
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    } else {
      const cursor = new Date(start);
      let safety = 0;
      while (cursor <= end && safety <= MAX_OCCURRENCES + 1) {
        dates.push(ymd(cursor));
        if (repeatsVal === "weekly") cursor.setDate(cursor.getDate() + 7);
        else if (repeatsVal === "biweekly") cursor.setDate(cursor.getDate() + 14);
        else if (repeatsVal === "monthly") cursor.setMonth(cursor.getMonth() + 1);
        else break;
        safety++;
      }
    }

    if (dates.length === 0) {
      return NextResponse.json(
        { error: "No practice dates produced — check the start/end dates and weekdays" },
        { status: 400 }
      );
    }
    if (dates.length > MAX_OCCURRENCES) {
      return NextResponse.json(
        { error: `Too many occurrences (max ${MAX_OCCURRENCES}). Shorten the date range.` },
        { status: 400 }
      );
    }
  }

  const series = await prisma.practiceSeries.create({
    data: {
      groupId: id,
      name: cleanName,
      location: cleanLocation,
      practiceTime: cleanTime,
      notes: cleanNotes,
      practices: {
        create: dates.map((d) => ({ practiceDate: d })),
      },
    },
    include: {
      practices: {
        orderBy: [{ practiceDate: "asc" }],
        include: {
          availabilities: {
            include: {
              user: { select: { id: true, name: true, profileImageUrl: true } },
            },
          },
        },
      },
    },
  });

  // Post an announcement to the team chat AND the team feed.
  // Failures here don't roll back the series — captain can re-share manually.
  const announcement = buildAnnouncement({
    name: cleanName,
    location: cleanLocation,
    practiceTime: cleanTime,
    notes: cleanNotes,
    dates,
    repeats: repeatsVal,
  });

  try {
    await prisma.groupMessage.create({
      data: {
        content: announcement,
        groupId: id,
        senderId: session.user.id,
      },
    });
  } catch (e) {
    console.error("[practices POST] failed to post chat announcement:", e);
  }

  try {
    await prisma.post.create({
      data: {
        content: announcement,
        postType: "announcement",
        playDate: dates[0] || "",
        playTime: cleanTime,
        courtLocation: cleanLocation,
        teamGroupId: id,
        authorId: session.user.id,
        postGroups: { create: [{ groupId: id }] },
      },
    });
  } catch (e) {
    console.error("[practices POST] failed to post feed announcement:", e);
  }

  return NextResponse.json(series);
}
