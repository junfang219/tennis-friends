import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const highlight = await prisma.highlight.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!highlight) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (highlight.userId !== session.user.id) {
    return NextResponse.json({ error: "Not your highlight" }, { status: 403 });
  }

  await prisma.highlight.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
