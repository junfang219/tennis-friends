import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET — look up an invite by token. Public (the accept page reads this
// before sign-in). Returns just the team name, inviter name, status, and
// expiry — never the recipient email — so the URL alone can't leak PII.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const invite = await prisma.groupInvite.findUnique({
    where: { token },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      group: { select: { id: true, name: true, imageUrl: true } },
      invitedBy: { select: { name: true } },
    },
  });

  if (!invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  const effectiveStatus = invite.status === "PENDING" && invite.expiresAt < new Date()
    ? "EXPIRED"
    : invite.status;

  return NextResponse.json({
    status: effectiveStatus,
    expiresAt: invite.expiresAt,
    team: invite.group,
    inviterName: invite.invitedBy.name,
  });
}
