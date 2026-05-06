import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { validateHandle } from "@/lib/handle";

export async function POST(request: Request) {
  try {
    const { name, email, password, handle } = await request.json();

    if (!name || !email || !password) {
      return NextResponse.json({ error: "Name, email, and password are required" }, { status: 400 });
    }

    let normalizedHandle: string | null = null;
    if (handle && typeof handle === "string" && handle.trim()) {
      const v = validateHandle(handle);
      if (!v.ok) {
        return NextResponse.json({ error: v.error, field: "handle" }, { status: 400 });
      }
      const taken = await prisma.user.findUnique({ where: { handle: v.value } });
      if (taken) {
        return NextResponse.json({ error: "Handle is already taken.", field: "handle" }, { status: 409 });
      }
      normalizedHandle = v.value;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, passwordHash, handle: normalizedHandle },
    });

    return NextResponse.json({ id: user.id, name: user.name, email: user.email, handle: user.handle });
  } catch {
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
