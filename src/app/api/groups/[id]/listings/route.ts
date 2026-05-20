import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { hasRole, ROLE } from "@/lib/groupRoles";

const ALLOWED_FORMATS = ["any", "singles", "doubles", "mixed_doubles"];
const MAX_TITLE = 120;
const MAX_DESCRIPTION = 1000;
const MAX_CITY = 60;

// GET — listings created by this team (any of its members can see them).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: id, userId: session.user.id } },
    select: { id: true },
  });
  if (!membership) {
    return NextResponse.json({ error: "Not a member of this team" }, { status: 403 });
  }

  const listings = await prisma.teamListing.findMany({
    where: { groupId: id },
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { id: true, name: true, profileImageUrl: true } } },
  });
  return NextResponse.json(listings);
}

// POST — create a listing on behalf of the team. MANAGER+ only since
// listings are public-facing and represent the team.
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
    return NextResponse.json({ error: "Only a team manager can post listings" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const { title, description, format, ntrpMin, ntrpMax, city, expiresInDays } = body as {
    title?: unknown;
    description?: unknown;
    format?: unknown;
    ntrpMin?: unknown;
    ntrpMax?: unknown;
    city?: unknown;
    expiresInDays?: unknown;
  };

  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const fmt = typeof format === "string" && ALLOWED_FORMATS.includes(format) ? format : "any";

  const ntrpRange = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n < 1.0 || n > 7.0) return null;
    return n;
  };
  const ntrpMinVal = ntrpRange(ntrpMin);
  const ntrpMaxVal = ntrpRange(ntrpMax);

  let expiresAt: Date | null = null;
  if (typeof expiresInDays === "number" && Number.isFinite(expiresInDays) && expiresInDays > 0) {
    const days = Math.min(90, Math.floor(expiresInDays));
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  const listing = await prisma.teamListing.create({
    data: {
      groupId: id,
      createdById: session.user.id,
      title: title.trim().slice(0, MAX_TITLE),
      description: typeof description === "string" ? description.trim().slice(0, MAX_DESCRIPTION) : "",
      format: fmt,
      ntrpMin: ntrpMinVal,
      ntrpMax: ntrpMaxVal,
      city: typeof city === "string" ? city.trim().slice(0, MAX_CITY) : "",
      expiresAt,
    },
    include: { createdBy: { select: { id: true, name: true, profileImageUrl: true } } },
  });
  return NextResponse.json(listing);
}
