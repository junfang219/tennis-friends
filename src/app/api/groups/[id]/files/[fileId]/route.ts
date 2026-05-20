import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { hasRole, ROLE } from "@/lib/groupRoles";

// DELETE — uploader or CAPTAIN+ can remove. Storage cleanup is intentionally
// not done here — the upload endpoint owns lifecycle once storage moves
// off local FS (PR #8 follow-up).
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, fileId } = await params;

  const file = await prisma.groupFile.findUnique({ where: { id: fileId } });
  if (!file || file.groupId !== id) {
    return NextResponse.json({ error: "File not found in this team" }, { status: 404 });
  }

  const isUploader = file.uploadedById === session.user.id;
  if (!isUploader && !(await hasRole(id, session.user.id, ROLE.CAPTAIN))) {
    return NextResponse.json(
      { error: "Only the uploader or a captain can remove this file" },
      { status: 403 }
    );
  }

  await prisma.groupFile.delete({ where: { id: fileId } });
  return NextResponse.json({ success: true });
}
