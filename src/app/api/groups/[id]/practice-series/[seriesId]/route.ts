import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

async function captainGuard(userId: string, groupId: string, seriesId: string) {
  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) return { error: "Team not found", status: 404 } as const;
  if (group.ownerId !== userId)
    return { error: "Only the team captain can modify practices", status: 403 } as const;

  const series = await prisma.practiceSeries.findUnique({ where: { id: seriesId } });
  if (!series || series.groupId !== groupId)
    return { error: "Series not found in this team", status: 404 } as const;

  return { series } as const;
}

// PATCH edit a practice series (captain only)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; seriesId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, seriesId } = await params;
  const guard = await captainGuard(session.user.id, id, seriesId);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const { name, location, practiceTime, notes } = await request.json();

  const data: Record<string, string> = {};
  if (typeof name === "string") {
    if (!name.trim()) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    data.name = name.trim();
  }
  if (typeof location === "string") {
    if (!location.trim()) return NextResponse.json({ error: "location cannot be empty" }, { status: 400 });
    data.location = location.trim();
  }
  if (typeof practiceTime === "string") data.practiceTime = practiceTime;
  if (typeof notes === "string") data.notes = notes.trim();

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await prisma.practiceSeries.update({
    where: { id: seriesId },
    data,
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

  return NextResponse.json(updated);
}

// DELETE a practice series and all its practices (captain only)
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; seriesId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, seriesId } = await params;
  const guard = await captainGuard(session.user.id, id, seriesId);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  await prisma.practiceSeries.delete({ where: { id: seriesId } });
  return NextResponse.json({ success: true });
}
