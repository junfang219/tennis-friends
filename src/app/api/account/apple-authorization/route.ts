import { NextResponse } from "next/server";
import { z } from "zod";
import { storeAppleAuthorization } from "@/lib/auth/appleRevocation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const input = z.object({ code: z.string().trim().min(1).max(2048) }).strict();

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return new Response(null, { status: 415 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  const db = await createSupabaseServerClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return new Response(null, { status: 401 });
  try {
    return NextResponse.json({ saved: await storeAppleAuthorization(user, parsed.data.code) });
  } catch {
    return NextResponse.json({ saved: false });
  }
}
