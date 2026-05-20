import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// GET /api/matchup — browse open team listings across the platform.
// Filterable by ?format=, ?ntrp= (caller's rating, matches when in range),
// ?city=. Auth required — listings expose team info and aren't fully public.
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format");
  const city = searchParams.get("city");
  const ntrp = Number(searchParams.get("ntrp"));

  const now = new Date();
  const listings = await prisma.teamListing.findMany({
    where: {
      status: "OPEN",
      // Allow listings with no expiry (null) or future expiry; hide expired.
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      ...(format && format !== "any" ? { format } : {}),
      ...(city ? { city: { contains: city } } : {}),
      // NTRP range filter — caller passes their rating; only show listings
      // that either have no bounds or whose bounds include the caller.
      ...(Number.isFinite(ntrp)
        ? {
            AND: [
              { OR: [{ ntrpMin: null }, { ntrpMin: { lte: ntrp } }] },
              { OR: [{ ntrpMax: null }, { ntrpMax: { gte: ntrp } }] },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      group: { select: { id: true, name: true, imageUrl: true } },
      createdBy: { select: { id: true, name: true, profileImageUrl: true } },
    },
  });

  return NextResponse.json(listings);
}
