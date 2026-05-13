import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

type Distribution = { 1: number; 2: number; 3: number; 4: number; 5: number };

function buildSummary(stars: number[]) {
  const dist: Distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const s of stars) {
    if (s >= 1 && s <= 5) dist[s as 1 | 2 | 3 | 4 | 5]++;
  }
  const count = stars.length;
  const avg = count === 0 ? 0 : stars.reduce((a, b) => a + b, 0) / count;
  return { avg, count, distribution: dist };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: courtId } = await params;
  const session = await auth();
  const userId = session?.user?.id ?? null;

  const reviews = await prisma.courtReview.findMany({
    where: { courtId },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { id: true, name: true, profileImageUrl: true } },
      photos: { orderBy: { order: "asc" }, select: { url: true } },
    },
  });

  const summary = buildSummary(reviews.map((r) => r.stars));

  const formatted = reviews.map((r) => ({
    id: r.id,
    courtId: r.courtId,
    stars: r.stars,
    content: r.content,
    photoUrls: r.photos.map((p) => p.url),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    user: r.user,
    isMine: userId !== null && r.user.id === userId,
  }));

  const mine = formatted.find((r) => r.isMine) ?? null;

  return NextResponse.json({ ...summary, mine, reviews: formatted });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id: courtId } = await params;

  if (!courtId.trim()) {
    return NextResponse.json({ error: "Missing court id" }, { status: 400 });
  }

  let body: { stars?: unknown; content?: unknown; photoUrls?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const stars = Number(body.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return NextResponse.json(
      { error: "stars must be an integer 1..5" },
      { status: 400 }
    );
  }

  const content =
    typeof body.content === "string" ? body.content.trim().slice(0, 4000) : "";

  let photoUrls: string[] = [];
  if (Array.isArray(body.photoUrls)) {
    photoUrls = body.photoUrls
      .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
      .slice(0, 9);
  }

  // Upsert: if the user already has a review for this court, replace its
  // contents and photo set; otherwise create a fresh row.
  const existing = await prisma.courtReview.findUnique({
    where: { courtId_userId: { courtId, userId } },
    select: { id: true },
  });

  let reviewId: string;
  if (existing) {
    await prisma.courtReviewPhoto.deleteMany({ where: { reviewId: existing.id } });
    await prisma.courtReview.update({
      where: { id: existing.id },
      data: {
        stars,
        content,
        photos:
          photoUrls.length > 0
            ? { create: photoUrls.map((url, i) => ({ url, order: i })) }
            : undefined,
      },
    });
    reviewId = existing.id;
  } else {
    const created = await prisma.courtReview.create({
      data: {
        courtId,
        userId,
        stars,
        content,
        photos:
          photoUrls.length > 0
            ? { create: photoUrls.map((url, i) => ({ url, order: i })) }
            : undefined,
      },
    });
    reviewId = created.id;
  }

  const fresh = await prisma.courtReview.findUnique({
    where: { id: reviewId },
    include: {
      user: { select: { id: true, name: true, profileImageUrl: true } },
      photos: { orderBy: { order: "asc" }, select: { url: true } },
    },
  });

  if (!fresh) {
    return NextResponse.json({ error: "Failed to load saved review" }, { status: 500 });
  }

  return NextResponse.json({
    id: fresh.id,
    courtId: fresh.courtId,
    stars: fresh.stars,
    content: fresh.content,
    photoUrls: fresh.photos.map((p) => p.url),
    createdAt: fresh.createdAt,
    updatedAt: fresh.updatedAt,
    user: fresh.user,
    isMine: true,
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: courtId } = await params;

  await prisma.courtReview
    .delete({
      where: { courtId_userId: { courtId, userId: session.user.id } },
    })
    .catch(() => null);

  return NextResponse.json({ ok: true });
}
