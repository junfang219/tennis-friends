import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { hasRole, ROLE } from "@/lib/groupRoles";

// PATCH — rename, set active, change dates (MANAGER+)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; seasonId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, seasonId } = await params;
  if (!(await hasRole(id, session.user.id, ROLE.MANAGER))) {
    return NextResponse.json({ error: "Only a team manager can edit seasons" }, { status: 403 });
  }

  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  if (!season || season.groupId !== id) {
    return NextResponse.json({ error: "Season not found in this team" }, { status: 404 });
  }

  const { name, startDate, endDate, isActive } = await request.json();
  const data: { name?: string; startDate?: Date | null; endDate?: Date | null; isActive?: boolean } = {};

  if (typeof name === "string") {
    const trimmed = name.trim();
    if (!trimmed) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    if (trimmed.length > 64) return NextResponse.json({ error: "name too long" }, { status: 400 });
    data.name = trimmed;
  }
  if (startDate === null) data.startDate = null;
  else if (typeof startDate === "string") data.startDate = new Date(startDate);
  if (endDate === null) data.endDate = null;
  else if (typeof endDate === "string") data.endDate = new Date(endDate);
  if (typeof isActive === "boolean") data.isActive = isActive;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // If we're setting this season active, deactivate the rest in the same tx.
  const updated = await prisma.$transaction(async (tx) => {
    if (data.isActive === true) {
      await tx.season.updateMany({
        where: { groupId: id, isActive: true, NOT: { id: seasonId } },
        data: { isActive: false },
      });
    }
    return tx.season.update({ where: { id: seasonId }, data });
  });

  return NextResponse.json(updated);
}

// DELETE — remove the season. TeamMatch/PracticeSeries/Event.seasonId is
// SetNull, so existing entities just become "unscheduled".
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; seasonId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, seasonId } = await params;
  if (!(await hasRole(id, session.user.id, ROLE.MANAGER))) {
    return NextResponse.json({ error: "Only a team manager can delete seasons" }, { status: 403 });
  }

  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  if (!season || season.groupId !== id) {
    return NextResponse.json({ error: "Season not found in this team" }, { status: 404 });
  }

  await prisma.season.delete({ where: { id: seasonId } });
  return NextResponse.json({ success: true });
}
