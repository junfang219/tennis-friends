import { NextRequest, NextResponse } from "next/server";
import { getFacilities, type Facility, descriptionPreview } from "@/lib/facilities";

// Result shape mirrors a subset of what facilityToResult in
// /api/courts/route.ts produces — so the client can pre-populate
// `courtsMapRef` with consistent fields when the user picks a search hit.
type CourtSearchResult = {
  courtId: string;
  name: string;
  address: string | null;
  city: string | null;
  lat: number;
  lng: number;
  bucket: Facility["bucket"];
  category: Facility["category"];
  bookable: boolean;
  bookingUrl: string | null;
  courts: number | null;
  descriptionPreview: string | null;
};

// Higher score = better match. Stable tiebreaker on externalId keeps order
// deterministic between queries (no result flicker when typing).
function score(name: string, q: string): number {
  const n = name.toLowerCase();
  if (n.startsWith(q)) return 3;
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(n)) return 2;
  if (n.includes(q)) return 1;
  return 0;
}

const LIMIT = 8;

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  if (!q) {
    return NextResponse.json({ error: "missing q" }, { status: 400 });
  }
  if (q.length < 2) {
    // Avoid noisy single-letter scans; client already enforces this, but
    // belt-and-braces in case some other caller hits the endpoint.
    return NextResponse.json([]);
  }

  const all = getFacilities();
  const ranked: Array<{ f: Facility; s: number }> = [];
  for (const f of all) {
    if (f.latitude == null || f.longitude == null) continue;
    const s = score(f.name, q);
    if (s > 0) ranked.push({ f, s });
  }
  ranked.sort((a, b) => b.s - a.s || a.f.externalId - b.f.externalId);

  const results: CourtSearchResult[] = ranked.slice(0, LIMIT).map(({ f }) => ({
    courtId: f.courtId,
    name: f.name,
    address: f.address,
    city: f.city,
    lat: f.latitude!,
    lng: f.longitude!,
    bucket: f.bucket,
    category: f.category,
    bookable: f.bookable,
    bookingUrl: f.bookable && !f.bookingLinks ? f.bookingUrl : null,
    courts: f.courtCount,
    descriptionPreview: descriptionPreview(f.description),
  }));

  return NextResponse.json(results);
}
