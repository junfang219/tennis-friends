import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getMemberRole, hasRole, parseMemberTypes, ROLE, type GroupRole } from "@/lib/groupRoles";
import { sendInviteEmail } from "@/lib/inviteEmail";

const INVITE_TTL_DAYS = 14;
const ASSIGNABLE_ROLES: GroupRole[] = [ROLE.MANAGER, ROLE.CAPTAIN, ROLE.MEMBER];

// Minimal email shape check — matches what the existing report routes use.
function isPlausibleEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

// GET — list invites for the team. Members see pending invites; MANAGER+ can
// optionally see the full history via ?status=all.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const role = await getMemberRole(id, session.user.id);
  if (role === null) {
    return NextResponse.json({ error: "Not a member of this team" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const wantAll = searchParams.get("status") === "all";
  const isManager = await hasRole(id, session.user.id, ROLE.MANAGER);

  const where = wantAll && isManager
    ? { groupId: id }
    : { groupId: id, status: "PENDING" as const };

  const invites = await prisma.groupInvite.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      invitedBy: { select: { id: true, name: true, profileImageUrl: true } },
    },
  });

  return NextResponse.json(invites);
}

// POST — create an invite and send the email (MANAGER+ only).
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
    return NextResponse.json({ error: "Only a team manager can invite by email" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const { email: rawEmail, role: rawRole, memberType: rawType } = body as {
    email?: unknown;
    role?: unknown;
    memberType?: unknown;
  };

  if (typeof rawEmail !== "string" || !isPlausibleEmail(rawEmail)) {
    return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });
  }
  const email = rawEmail.trim().toLowerCase();

  const role: GroupRole = typeof rawRole === "string" && ASSIGNABLE_ROLES.includes(rawRole as GroupRole)
    ? (rawRole as GroupRole)
    : ROLE.MEMBER;

  const group = await prisma.group.findUnique({
    where: { id },
    select: { id: true, name: true, memberTypes: true },
  });
  if (!group) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  let memberType = "";
  if (typeof rawType === "string" && rawType.trim() !== "") {
    const allowed = parseMemberTypes(group.memberTypes);
    if (!allowed.includes(rawType.trim())) {
      return NextResponse.json(
        { error: `memberType must be one of ${allowed.join(", ")}` },
        { status: 400 }
      );
    }
    memberType = rawType.trim();
  }

  // If a User with this email already exists AND is already a member, reject.
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existingUser) {
    const existingMembership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: id, userId: existingUser.id } },
      select: { id: true },
    });
    if (existingMembership) {
      return NextResponse.json(
        { error: "This person is already on the team." },
        { status: 409 }
      );
    }
  }

  // Cancel any prior pending invite for the same email — replacing keeps the
  // list clean and resets the expiry/token.
  await prisma.groupInvite.updateMany({
    where: { groupId: id, email, status: "PENDING" },
    data: { status: "CANCELLED" },
  });

  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const invite = await prisma.groupInvite.create({
    data: {
      groupId: id,
      email,
      invitedById: session.user.id,
      role,
      memberType,
      expiresAt,
    },
    include: {
      invitedBy: { select: { id: true, name: true, profileImageUrl: true } },
    },
  });

  // Build the accept URL from the inbound origin so dev / prod both work.
  const origin = new URL(request.url).origin;
  const acceptUrl = `${origin}/invite/${invite.token}`;

  const emailError = await sendInviteEmail({
    to: email,
    inviterName: session.user.name || "A team manager",
    teamName: group.name,
    acceptUrl,
    expiresAt,
  });

  return NextResponse.json({ invite, emailError });
}
