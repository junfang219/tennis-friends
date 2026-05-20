import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// POST — accept the invite as the currently signed-in user.
// Requires the user's email to (case-insensitively) match the invite target;
// no auto-account creation. Idempotent: if the user is already a member of
// the team, we just mark the invite ACCEPTED and return success.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in to accept the invite" }, { status: 401 });
  }

  const { token } = await params;

  const invite = await prisma.groupInvite.findUnique({
    where: { token },
    include: { group: { select: { id: true, name: true } } },
  });
  if (!invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  if (invite.status === "CANCELLED") {
    return NextResponse.json({ error: "This invite was cancelled" }, { status: 410 });
  }
  if (invite.status === "ACCEPTED") {
    // Already redeemed — treat as success if it was THIS user, otherwise reject.
    if (invite.acceptedById === session.user.id) {
      return NextResponse.json({ groupId: invite.groupId, alreadyMember: true });
    }
    return NextResponse.json({ error: "This invite was already used" }, { status: 410 });
  }
  if (invite.status === "EXPIRED" || invite.expiresAt < new Date()) {
    if (invite.status !== "EXPIRED") {
      await prisma.groupInvite.update({ where: { id: invite.id }, data: { status: "EXPIRED" } });
    }
    return NextResponse.json({ error: "This invite has expired" }, { status: 410 });
  }

  // Email match — case-insensitive, but never allow accept when the caller has
  // no email at all (phone-only accounts can't redeem email invites).
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true },
  });
  if (!me?.email || me.email.toLowerCase() !== invite.email.toLowerCase()) {
    return NextResponse.json(
      {
        error: "This invite is for a different email address. Sign in with the invited account.",
        invitedEmail: invite.email,
      },
      { status: 403 }
    );
  }

  // Create membership if not already present.
  const existing = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: invite.groupId, userId: session.user.id } },
    select: { id: true },
  });

  if (!existing) {
    await prisma.groupMember.create({
      data: {
        groupId: invite.groupId,
        userId: session.user.id,
        role: invite.role,
        memberType: invite.memberType,
      },
    });
  }

  await prisma.groupInvite.update({
    where: { id: invite.id },
    data: {
      status: "ACCEPTED",
      acceptedById: session.user.id,
      acceptedAt: new Date(),
    },
  });

  return NextResponse.json({ groupId: invite.groupId, alreadyMember: !!existing });
}
