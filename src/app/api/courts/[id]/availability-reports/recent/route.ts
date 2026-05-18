import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getFacilityByCourtId } from "@/lib/facilities";

const ELIGIBLE_CATEGORIES = new Set(["public_park", "school", "college"]);
const FRESHNESS_MS = 60 * 60 * 1000;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: courtId } = await params;
  if (!courtId.trim()) {
    return NextResponse.json({ error: "Missing courtId" }, { status: 400 });
  }

  const facility = getFacilityByCourtId(courtId);
  if (!facility || !ELIGIBLE_CATEGORIES.has(facility.category)) {
    return NextResponse.json({ count: 0, emptyCount: 0, lastReportedAt: null });
  }

  const cutoff = new Date(Date.now() - FRESHNESS_MS);
  const reports = await prisma.courtAvailabilityReport.findMany({
    where: { courtId, reportedAt: { gt: cutoff } },
    orderBy: { reportedAt: "desc" },
    select: { hasEmpty: true, reportedAt: true },
  });

  const count = reports.length;
  const emptyCount = reports.filter((r) => r.hasEmpty).length;
  const lastReportedAt = reports[0]?.reportedAt.toISOString() ?? null;

  return NextResponse.json({ count, emptyCount, lastReportedAt });
}
