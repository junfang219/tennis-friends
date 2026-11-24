import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getContentModerator } from "@/lib/moderation/server";
import { publicSupabaseUrl } from "@/lib/supabase/env";
import { bucketAcceptsMime, screenedMediaBuckets } from "@/lib/supabase/storage";

const schema = z.object({
  bucket: z.enum(screenedMediaBuckets),
  owner: z.uuid(),
  file: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/i).max(200),
});
const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, context: { params: Promise<{ bucket: string; owner: string; file: string }> }) {
  const parsed = schema.safeParse(await context.params);
  if (!parsed.success) return new Response(null, { status: 404, headers: privateHeaders });
  const { bucket, owner, file } = parsed.data;
  const review = new URL(request.url).searchParams.get("review") === "1";
  if (review && !await getContentModerator()) return new Response(null, { status: 404, headers: privateHeaders });
  const db = review ? createSupabaseAdminClient() : await createSupabaseServerClient();
  const { data, error } = await db.storage.from(bucket).createSignedUrl(owner + "/" + file, 30);
  if (error || !data) return new Response(null, { status: 404, headers: privateHeaders });
  if (new URL(data.signedUrl).origin !== new URL(publicSupabaseUrl()).origin) return new Response(null, { status: 502, headers: privateHeaders });
  const range = request.headers.get("range");
  try {
    const upstream = await fetch(data.signedUrl, {
      cache: "no-store", redirect: "error", signal: request.signal,
      headers: range ? { Range: range } : undefined,
    });
    const type = upstream.headers.get("content-type")?.split(";")[0] ?? "";
    if (upstream.status === 416) {
      const total = upstream.headers.get("content-range");
      return new Response(null, { status: 416, headers: total ? { ...privateHeaders, "Content-Range": total } : privateHeaders });
    }
    if (!upstream.ok || !bucketAcceptsMime(bucket, type)) {
      await upstream.body?.cancel();
      return new Response(null, { status: 404, headers: privateHeaders });
    }
    const headers = new Headers({
      ...privateHeaders,
      "Content-Type": type,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
    for (const name of ["content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return new Response(null, { status: 502, headers: privateHeaders });
  }
}
