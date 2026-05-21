import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { rateLimit } from "@/lib/rateLimit";
import { geocodeAddress } from "@/lib/geocode";

const HOUR_MS = 60 * 60 * 1000;

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json({ error: "Missing q" }, { status: 400 });
  if (q.length > 200) return NextResponse.json({ error: "Address too long" }, { status: 400 });

  const rl = rateLimit(`geocode:${session.user.id}`, 30, HOUR_MS);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Geocode limit reached. Try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  const hit = await geocodeAddress(q);
  if (!hit) return NextResponse.json({ error: "Couldn't find that address" }, { status: 404 });
  return NextResponse.json(hit);
}
