import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getMemberRole, hasRole, ROLE } from "@/lib/groupRoles";

// GET — list team files (any member).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if ((await getMemberRole(id, session.user.id)) === null) {
    return NextResponse.json({ error: "Not a member of this team" }, { status: 403 });
  }

  const files = await prisma.groupFile.findMany({
    where: { groupId: id },
    orderBy: { createdAt: "desc" },
    include: { uploadedBy: { select: { id: true, name: true, profileImageUrl: true } } },
  });
  return NextResponse.json(files);
}

// POST — register a file (CAPTAIN+). Body shape:
//   { url, filename, mimeType?, sizeBytes?, description? }
// URL typically comes from /api/upload.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!(await hasRole(id, session.user.id, ROLE.CAPTAIN))) {
    return NextResponse.json({ error: "Only a team captain can add files" }, { status: 403 });
  }

  const { url, filename, mimeType, sizeBytes, description } = await request.json();
  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }
  if (typeof filename !== "string" || !filename.trim()) {
    return NextResponse.json({ error: "filename is required" }, { status: 400 });
  }

  const created = await prisma.groupFile.create({
    data: {
      groupId: id,
      url: url.trim(),
      filename: filename.trim().slice(0, 255),
      mimeType: typeof mimeType === "string" ? mimeType.slice(0, 100) : "",
      sizeBytes: typeof sizeBytes === "number" && Number.isFinite(sizeBytes) && sizeBytes >= 0 ? Math.floor(sizeBytes) : 0,
      description: typeof description === "string" ? description.trim().slice(0, 500) : "",
      uploadedById: session.user.id,
    },
    include: { uploadedBy: { select: { id: true, name: true, profileImageUrl: true } } },
  });

  return NextResponse.json(created);
}
