import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { haversineMiles } from "@/lib/distance";
import { parseTags } from "@/lib/tags";

const MINUTE = 60 * 1000;

type Bucket = "beginner" | "intermediate" | "advanced" | "pro";
const BUCKET_VALUES: Bucket[] = ["beginner", "intermediate", "advanced", "pro"];

function csvParam(searchParams: URLSearchParams, key: string): string[] {
  const raw = searchParams.get(key);
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function bucketWhere(buckets: Bucket[]): Prisma.UserWhereInput | null {
  if (buckets.length === 0) return null;
  const ranges: Record<Bucket, { min: number; max: number; self: string }> = {
    beginner:     { min: 2.5, max: 3.0, self: "beginner" },
    intermediate: { min: 3.0, max: 4.0, self: "intermediate" },
    advanced:     { min: 4.0, max: 5.0, self: "advanced" },
    pro:          { min: 5.0, max: 7.01, self: "professional" },
  };
  const orClauses: Prisma.UserWhereInput[] = [];
  for (const b of buckets) {
    const r = ranges[b];
    orClauses.push({
      AND: [
        { ratingSystem: "ntrp" },
        { ntrpRating: { gte: r.min, lt: r.max } },
      ],
    });
    orClauses.push({
      AND: [
        { ratingSystem: "self" },
        { skillLevel: r.self },
      ],
    });
  }
  return { OR: orClauses };
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const rawQ = (searchParams.get("q") || "").trim();
  const q = rawQ.replace(/^@+/, "");
  const email = searchParams.get("email")?.trim().toLowerCase() || "";
  const phone = searchParams.get("phone")?.trim() || "";

  const buckets = csvParam(searchParams, "bucket").filter((b): b is Bucket =>
    BUCKET_VALUES.includes(b as Bucket)
  );
  const ageRanges = csvParam(searchParams, "ageRange");
  const genders = csvParam(searchParams, "gender");
  const tag = (searchParams.get("tag") || "").trim();
  const sortParam = searchParams.get("sort");

  if (email || phone) {
    const lookup = rateLimit(`userLookup:${session.user.id}`, 30, MINUTE);
    if (!lookup.ok) {
      return NextResponse.json(
        { error: "Too many lookups. Slow down." },
        { status: 429, headers: { "Retry-After": String(lookup.retryAfterSec) } }
      );
    }
  }

  // Exclude users blocked in either direction.
  const blocks = await prisma.block.findMany({
    where: {
      OR: [{ blockerId: session.user.id }, { blockedId: session.user.id }],
    },
  });
  const blockedIds = Array.from(
    new Set(
      blocks.map((b) => (b.blockerId === session.user!.id ? b.blockedId : b.blockerId))
    )
  );

  const andClauses: Prisma.UserWhereInput[] = [
    { id: { not: session.user.id } },
  ];
  if (blockedIds.length > 0) andClauses.push({ id: { notIn: blockedIds } });
  if (email) andClauses.push({ email });
  else if (phone) andClauses.push({ phone });
  else if (q) andClauses.push({
    OR: [{ name: { contains: q } }, { handle: { contains: q.toLowerCase() } }],
  });
  const bucketClause = bucketWhere(buckets);
  if (bucketClause) andClauses.push(bucketClause);
  if (ageRanges.length > 0) andClauses.push({ ageRange: { in: ageRanges } });
  if (genders.length > 0) andClauses.push({ gender: { in: genders } });
  if (tag) andClauses.push({ customTags: { contains: tag } });

  const users = await prisma.user.findMany({
    where: { AND: andClauses },
    select: {
      id: true,
      name: true,
      skillLevel: true,
      favoriteSurface: true,
      profileImageUrl: true,
      bio: true,
      gender: true,
      ageRange: true,
      ratingSystem: true,
      ntrpRating: true,
      utrRating: true,
      handle: true,
      customTags: true,
      latitude: true,
      longitude: true,
      createdAt: true,
    },
    take: email || phone ? 1 : 50,
  });

  // Viewer's coords for distance ranking.
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { latitude: true, longitude: true },
  });
  const haveMyLocation = me?.latitude != null && me?.longitude != null;

  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [
        { requesterId: session.user.id, addresseeId: { in: users.map((u) => u.id) } },
        { addresseeId: session.user.id, requesterId: { in: users.map((u) => u.id) } },
      ],
    },
  });

  // Compute distance + strip raw coords from response.
  const enriched = users.map((u) => {
    const friendship = friendships.find(
      (f) =>
        (f.requesterId === session.user!.id && f.addresseeId === u.id) ||
        (f.addresseeId === session.user!.id && f.requesterId === u.id)
    );
    let distanceMiles: number | null = null;
    if (haveMyLocation && u.latitude != null && u.longitude != null) {
      distanceMiles = haversineMiles(
        me!.latitude as number,
        me!.longitude as number,
        u.latitude,
        u.longitude
      );
    }
    // Drop raw coordinates of strangers.
    const { latitude, longitude, customTags, createdAt, ...rest } = u;
    void latitude; void longitude;
    return {
      ...rest,
      customTags: parseTags(customTags),
      createdAt,
      distanceMiles,
      friendshipId: friendship?.id || null,
      friendshipStatus: friendship?.status || null,
      isRequester: friendship?.requesterId === session.user!.id,
    };
  });

  // Sort: distance (default when location set), or recent (createdAt desc).
  const sort = sortParam === "recent" || sortParam === "distance"
    ? sortParam
    : (haveMyLocation ? "distance" : "recent");
  if (sort === "distance") {
    enriched.sort((a, b) => {
      const ad = a.distanceMiles;
      const bd = b.distanceMiles;
      if (ad == null && bd == null) return 0;
      if (ad == null) return 1;
      if (bd == null) return -1;
      return ad - bd;
    });
  } else {
    enriched.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // Drop createdAt from the wire shape — clients didn't read it before.
  const wire = enriched.map(({ createdAt, ...rest }) => { void createdAt; return rest; });

  return NextResponse.json(wire);
}
