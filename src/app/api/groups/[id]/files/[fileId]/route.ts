import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { STORAGE_BUCKETS, objectKeyFromPublicUrl } from "@/lib/supabase/storage";

/**
 * Serves a team file by id.
 *
 * The `files` bucket is PRIVATE (waivers, schedules — not world-readable like
 * albums), so the public-object URL stored on the row does not resolve on its
 * own. This route is the "serving route" the Files page / viewer expect:
 *
 *   1. Fetch the group_files row through the RLS-aware server client. The
 *      `group_files_select_member` policy means a row only comes back if the
 *      caller is a member of the owning team — that IS the authorization check.
 *   2. Mint a short-lived signed URL (admin client, because RLS on
 *      storage.objects is owner-only and members aren't the uploader) and
 *      stream the bytes back from here.
 *
 * We proxy the bytes rather than 302-redirecting to the signed URL so the
 * response is SAME-ORIGIN: the in-app viewer embeds it in an <iframe>, and a
 * cross-origin storage response could be blocked from framing (and the
 * signed URL would leak to the client). Served inline so PDFs/images render
 * in the viewer; the viewer's own header provides the way back.
 */

// Sanitize a user-supplied filename for a Content-Disposition header value:
// drop quotes, backslashes, and CR/LF that would let it break out of the
// quoted-string or inject extra headers.
function safeDispositionName(filename: string): string {
  return filename.replace(/["\\\r\n]/g, "").slice(0, 200) || "file";
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; fileId: string }> }
) {
  const { id: groupId, fileId } = await ctx.params;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS (group_files_select_member) returns the row only to team members.
  const { data: file } = await supabase
    .from("group_files")
    .select("id, group_id, url, filename, mime_type")
    .eq("id", fileId)
    .eq("group_id", groupId)
    .maybeSingle();

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  // The stored url is a public-object URL; recover the object key so we can
  // sign the same object.
  const objectKey = objectKeyFromPublicUrl(file.url, STORAGE_BUCKETS.files);
  if (!objectKey) {
    return NextResponse.json({ error: "Malformed file URL" }, { status: 500 });
  }

  const admin = createSupabaseAdminClient();
  const { data: signed, error: signErr } = await admin.storage
    .from(STORAGE_BUCKETS.files)
    .createSignedUrl(objectKey, 60);

  if (signErr || !signed) {
    return NextResponse.json(
      { error: `Could not sign file: ${signErr?.message ?? "unknown"}` },
      { status: 500 }
    );
  }

  const upstream = await fetch(signed.signedUrl);
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: `Could not fetch file (${upstream.status})` },
      { status: 502 }
    );
  }

  const headers = new Headers();
  headers.set(
    "Content-Type",
    file.mime_type || upstream.headers.get("content-type") || "application/octet-stream"
  );
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  headers.set(
    "Content-Disposition",
    `inline; filename="${safeDispositionName(file.filename)}"`
  );
  // Private file — let the client cache briefly but never a shared cache.
  headers.set("Cache-Control", "private, max-age=60");

  return new NextResponse(upstream.body, { status: 200, headers });
}
