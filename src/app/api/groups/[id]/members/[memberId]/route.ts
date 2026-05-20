import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { hasRole, isAtLeast, parseMemberTypes, ROLE, type GroupRole } from "@/lib/groupRoles";

const ASSIGNABLE_ROLES: GroupRole[] = [ROLE.MANAGER, ROLE.CAPTAIN, ROLE.MEMBER];

// PATCH { role?, memberType? } — change a member's role and/or memberType.
// Requires MANAGER+ on the team. The OWNER row is immutable here; transferring
// team ownership is a separate flow we haven't built yet.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, memberId } = await params;

  if (!(await hasRole(id, session.user.id, ROLE.MANAGER))) {
    return NextResponse.json({ error: "Only a team manager can change roles" }, { status: 403 });
  }

  const member = await prisma.groupMember.findUnique({
    where: { id: memberId },
    include: { group: { select: { id: true, ownerId: true, memberTypes: true } } },
  });
  if (!member || member.groupId !== id) {
    return NextResponse.json({ error: "Member not found in this team" }, { status: 404 });
  }

  const { role, memberType } = await request.json();
  const data: { role?: string; memberType?: string } = {};

  if (typeof role === "string") {
    if (member.userId === member.group.ownerId) {
      return NextResponse.json(
        { error: "The team owner's role cannot be changed here" },
        { status: 400 }
      );
    }
    if (!ASSIGNABLE_ROLES.includes(role as GroupRole)) {
      return NextResponse.json(
        { error: `role must be one of ${ASSIGNABLE_ROLES.join(", ")}` },
        { status: 400 }
      );
    }
    // Only OWNER can grant the MANAGER role — keeps managers from minting peers.
    if (role === ROLE.MANAGER && !isAtLeast(await callerRole(id, session.user.id), ROLE.OWNER)) {
      return NextResponse.json(
        { error: "Only the team owner can promote members to manager" },
        { status: 403 }
      );
    }
    data.role = role;
  }

  if (typeof memberType === "string") {
    const trimmed = memberType.trim();
    if (trimmed !== "") {
      const allowed = parseMemberTypes(member.group.memberTypes);
      if (!allowed.includes(trimmed)) {
        return NextResponse.json(
          { error: `memberType must be one of ${allowed.join(", ")}` },
          { status: 400 }
        );
      }
    }
    data.memberType = trimmed;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await prisma.groupMember.update({
    where: { id: memberId },
    data,
    include: {
      user: { select: { id: true, name: true, profileImageUrl: true, skillLevel: true } },
    },
  });

  return NextResponse.json(updated);
}

// Local helper — avoids the second round-trip when we only need the caller's role.
async function callerRole(groupId: string, userId: string): Promise<string> {
  const m = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
    select: { role: true },
  });
  return m?.role ?? "";
}
