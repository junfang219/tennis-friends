import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  const [accepted, incoming, outgoing] = await Promise.all([
    prisma.friendship.findMany({
      where: {
        status: "ACCEPTED",
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      include: {
        requester: { select: { id: true, name: true, profileImageUrl: true, skillLevel: true, gender: true, ageRange: true, ratingSystem: true, ntrpRating: true, utrRating: true } },
        addressee: { select: { id: true, name: true, profileImageUrl: true, skillLevel: true, gender: true, ageRange: true, ratingSystem: true, ntrpRating: true, utrRating: true } },
      },
    }),
    prisma.friendship.findMany({
      where: { addresseeId: userId, status: "PENDING" },
      include: {
        requester: { select: { id: true, name: true, profileImageUrl: true, skillLevel: true, gender: true, ageRange: true, ratingSystem: true, ntrpRating: true, utrRating: true } },
      },
    }),
    prisma.friendship.findMany({
      where: { requesterId: userId, status: "PENDING" },
      include: {
        addressee: { select: { id: true, name: true, profileImageUrl: true, skillLevel: true, gender: true, ageRange: true, ratingSystem: true, ntrpRating: true, utrRating: true } },
      },
    }),
  ]);

  const friends = accepted.map((f) => ({
    friendshipId: f.id,
    user: f.requesterId === userId ? f.addressee : f.requester,
  }));

  const incomingRequests = incoming.map((f) => ({
    friendshipId: f.id,
    user: f.requester,
    createdAt: f.createdAt,
  }));

  const outgoingRequests = outgoing.map((f) => ({
    friendshipId: f.id,
    user: f.addressee,
  }));

  return NextResponse.json({ friends, incomingRequests, outgoingRequests });
}
