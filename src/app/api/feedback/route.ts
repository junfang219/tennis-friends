// BETA FEEDBACK — beta-only; safe to delete this file before public launch.
//
// Lets beta testers send feedback / feature requests / suggestions straight to
// my inbox. Same shape as report-missing-court: authenticated POST, Zod-
// validated, emailed via Resend. Reuses RESEND_API_KEY + REPORT_EMAIL; no
// new env vars.

import { NextResponse } from "next/server";
import { Resend } from "resend";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const FROM_ADDRESS = "TennisFriend <reports@mytennisfriends.com>";
const TO_ADDRESS = process.env.REPORT_EMAIL ?? "tennisfriends123@gmail.com";

const CATEGORY_LABELS: Record<string, string> = {
  bug: "Bug",
  feature: "Feature request",
  suggestion: "Suggestion",
  other: "Other",
};

const Body = z.object({
  category: z.enum(["bug", "feature", "suggestion", "other"]),
  message: z.string().min(3).max(4000),
  reporterEmail: z.string().email().optional(),
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.issues.map((i) => i.message).join("; ") : "Bad request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Email is not configured (RESEND_API_KEY missing)" }, { status: 503 });
  }

  const resend = new Resend(apiKey);
  const { data: profile } = await supabase
    .from("profiles")
    .select("name, email")
    .eq("id", auth.user.id)
    .maybeSingle();

  const categoryLabel = CATEGORY_LABELS[parsed.category] ?? parsed.category;
  const snippet = parsed.message.replace(/\s+/g, " ").trim().slice(0, 60);
  const subject = `Beta feedback [${categoryLabel}]: ${snippet}`;

  const html = `
    <p><strong>From:</strong> ${escapeHtml(profile?.name ?? "(unknown)")} &lt;${escapeHtml(parsed.reporterEmail ?? profile?.email ?? "no email")}&gt;</p>
    <p><strong>Category:</strong> ${escapeHtml(categoryLabel)}</p>
    <p><strong>Message:</strong><br>${escapeHtml(parsed.message).replace(/\n/g, "<br>")}</p>
    <hr>
    <p style="color:#888;font-size:12px">User ID: ${escapeHtml(auth.user.id)}</p>
  `;

  const result = await resend.emails.send({
    from: FROM_ADDRESS,
    to: TO_ADDRESS,
    subject,
    html,
    replyTo: parsed.reporterEmail || profile?.email || undefined,
  });

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
