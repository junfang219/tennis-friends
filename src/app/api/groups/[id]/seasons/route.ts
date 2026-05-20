import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getMemberRole, hasRole, ROLE } from "@/lib/groupRoles";

// GET — list all seasons for the team (any member)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if ((await getMemberRole(id, session.user.id)) === null) {
    return NextResponse.json({ error: "Not a member of this team" }, { status: 403 });
  }

  const seasons = await prisma.season.findMany({
    where: { groupId: id },
    orderBy: [{ isActive: "desc" }, { startDate: "desc" }, { createdAt: "desc" }],
  });

  return NextResponse.json(seasons);
}

// POST — create a season (MANAGER+)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!(await hasRole(id, session.user.id, ROLE.MANAGER))) {
    return NextResponse.json({ error: "Only a team manager can add seasons" }, { status: 403 });
  }

  const { name, startDate, endDate, isActive } = await request.json();
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (name.length > 64) {
    return NextResponse.json({ error: "name must be 64 chars or fewer" }, { status: 400 });
  }

  // At most one active season per team — flip everything else off when this
  // one is created active.
  const willBeActive = isActive === true;

  const season = await prisma.$transaction(async (tx) => {
    if (willBeActive) {
      await tx.season.updateMany({ where: { groupId: id, isActive: true }, data: { isActive: false } });
    }
    return tx.season.create({
      data: {
        groupId: id,
        name: name.trim(),
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        isActive: willBeActive,
      },
    });
  });

  return NextResponse.json(season);
}
