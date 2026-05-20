import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { hasRole, ROLE } from "@/lib/groupRoles";

// DELETE — cancel a pending invite. MANAGER+ can cancel any; non-managers
// may cancel only invites they sent themselves.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; inviteId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, inviteId } = await params;

  const invite = await prisma.groupInvite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.groupId !== id) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }
  if (invite.status !== "PENDING") {
    return NextResponse.json({ error: "Invite is no longer pending" }, { status: 400 });
  }

  const isManager = await hasRole(id, session.user.id, ROLE.MANAGER);
  const isSelf = invite.invitedById === session.user.id;
  if (!isManager && !isSelf) {
    return NextResponse.json(
      { error: "Only the inviter or a team manager can cancel this invite" },
      { status: 403 }
    );
  }

  await prisma.groupInvite.update({
    where: { id: inviteId },
    data: { status: "CANCELLED" },
  });
  return NextResponse.json({ success: true });
}
