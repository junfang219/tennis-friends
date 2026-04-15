import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const GENDERS = new Set(["male", "female", "non_binary", "prefer_not_to_say"]);
const AGE_RANGES = new Set(["under_18", "18_29", "30_49", "50_plus"]);
const SELF_LEVELS = new Set(["beginner", "intermediate", "advanced", "professional"]);

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { gender, ageRange, ratingSystem, ntrpRating, utrRating, skillLevel } = body as {
    gender?: string;
    ageRange?: string;
    ratingSystem?: string;
    ntrpRating?: number;
    utrRating?: number;
    skillLevel?: string;
  };

  if (!gender || !GENDERS.has(gender)) {
    return NextResponse.json({ error: "Please select a gender option" }, { status: 400 });
  }
  if (!ageRange || !AGE_RANGES.has(ageRange)) {
    return NextResponse.json({ error: "Please select an age range" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {
    gender,
    ageRange,
    ratingSystem: "",
    ntrpRating: null,
    utrRating: null,
  };

  if (ratingSystem === "ntrp") {
    const v = Number(ntrpRating);
    if (!(v >= 2.5 && v <= 7.0) || Math.round(v * 2) !== v * 2) {
      return NextResponse.json({ error: "NTRP must be 2.5–7.0 in 0.5 increments" }, { status: 400 });
    }
    updates.ratingSystem = "ntrp";
    updates.ntrpRating = v;
  } else if (ratingSystem === "utr") {
    const v = Number(utrRating);
    if (!(v >= 1.0 && v <= 16.5)) {
      return NextResponse.json({ error: "UTR must be between 1.0 and 16.5" }, { status: 400 });
    }
    updates.ratingSystem = "utr";
    updates.utrRating = v;
  } else if (ratingSystem === "self") {
    if (!skillLevel || !SELF_LEVELS.has(skillLevel)) {
      return NextResponse.json({ error: "Please pick a self-rated level" }, { status: 400 });
    }
    updates.ratingSystem = "self";
    updates.skillLevel = skillLevel;
  } else {
    return NextResponse.json({ error: "Please provide at least one tennis rating" }, { status: 400 });
  }

  updates.onboardingComplete = true;

  await prisma.user.update({
    where: { id: session.user.id },
    data: updates,
  });

  return NextResponse.json({ ok: true });
}
