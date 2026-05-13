import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const MAX_IDS = 200;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids") ?? "";
  const ids = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS);

  if (ids.length === 0) return NextResponse.json({});

  const reviews = await prisma.courtReview.findMany({
    where: { courtId: { in: ids } },
    orderBy: { createdAt: "desc" },
    select: {
      courtId: true,
      stars: true,
      photos: { orderBy: { order: "asc" }, select: { url: true }, take: 1 },
    },
  });

  const result: Record<
    string,
    { avg: number; count: number; thumbs: string[] }
  > = {};

  for (const id of ids) result[id] = { avg: 0, count: 0, thumbs: [] };

  // Aggregate sums per court id, and collect up to 3 most-recent thumbs.
  const sums: Record<string, { sum: number; count: number }> = {};
  for (const r of reviews) {
    const s = sums[r.courtId] ?? (sums[r.courtId] = { sum: 0, count: 0 });
    s.sum += r.stars;
    s.count += 1;
    const bucket = result[r.courtId];
    if (r.photos[0]?.url && bucket.thumbs.length < 3) {
      bucket.thumbs.push(r.photos[0].url);
    }
  }

  for (const id of Object.keys(sums)) {
    result[id].count = sums[id].count;
    result[id].avg = sums[id].count > 0 ? sums[id].sum / sums[id].count : 0;
  }

  return NextResponse.json(result);
}
