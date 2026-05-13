import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { token, platform } = body as { token?: unknown; platform?: unknown };
  if (typeof token !== "string" || token.trim().length < 8) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }
  const plat = platform === "android" ? "android" : "ios";

  // Upsert on `token`: if the same physical device previously belonged to
  // a different account, transfer ownership to the current user.
  await prisma.deviceToken.upsert({
    where: { token },
    create: { token, platform: plat, userId: session.user.id },
    update: { userId: session.user.id, platform: plat },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const token = body && typeof body.token === "string" ? body.token : null;
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });
  // Only delete if it's actually owned by the caller.
  await prisma.deviceToken.deleteMany({ where: { token, userId: session.user.id } });
  return NextResponse.json({ ok: true });
}
