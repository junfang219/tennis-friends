import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const { email, password, name, skillLevel, favoriteSurface } =
      await request.json();

    if (!email || !password || !name) {
      return NextResponse.json(
        { error: "Email, password, and name are required" },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        skillLevel: skillLevel || "intermediate",
        favoriteSurface: favoriteSurface || "hard",
      },
    });

    return NextResponse.json({ id: user.id, email: user.email, name: user.name });
  } catch {
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
