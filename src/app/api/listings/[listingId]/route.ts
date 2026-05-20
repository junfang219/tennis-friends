import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { hasRole, ROLE } from "@/lib/groupRoles";

const ALLOWED_STATUS = ["OPEN", "FILLED", "CLOSED"];

// PATCH — update status (mark filled/closed) or edit title/description.
// Allowed for the original poster OR any MANAGER+ on the listing's team.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ listingId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { listingId } = await params;
  const listing = await prisma.teamListing.findUnique({ where: { id: listingId } });
  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  const isOwn = listing.createdById === session.user.id;
  if (!isOwn && !(await hasRole(listing.groupId, session.user.id, ROLE.MANAGER))) {
    return NextResponse.json(
      { error: "Only the poster or a team manager can edit this listing" },
      { status: 403 }
    );
  }

  const { status, title, description } = await request.json();
  const data: { status?: string; title?: string; description?: string } = {};
  if (typeof status === "string") {
    if (!ALLOWED_STATUS.includes(status)) {
      return NextResponse.json({ error: `status must be one of ${ALLOWED_STATUS.join(", ")}` }, { status: 400 });
    }
    data.status = status;
  }
  if (typeof title === "string") {
    if (!title.trim()) return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
    data.title = title.trim().slice(0, 120);
  }
  if (typeof description === "string") {
    data.description = description.trim().slice(0, 1000);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await prisma.teamListing.update({ where: { id: listingId }, data });
  return NextResponse.json(updated);
}

// DELETE — remove the listing entirely (poster or MANAGER+).
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ listingId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { listingId } = await params;
  const listing = await prisma.teamListing.findUnique({ where: { id: listingId } });
  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  const isOwn = listing.createdById === session.user.id;
  if (!isOwn && !(await hasRole(listing.groupId, session.user.id, ROLE.MANAGER))) {
    return NextResponse.json(
      { error: "Only the poster or a team manager can remove this listing" },
      { status: 403 }
    );
  }

  await prisma.teamListing.delete({ where: { id: listingId } });
  return NextResponse.json({ success: true });
}
