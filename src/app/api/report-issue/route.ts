import { NextResponse } from "next/server";
import { Resend } from "resend";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// One of the two surviving server routes — Resend's API key must stay
// server-only, so this report path can't be a direct supabase call.

const FROM_ADDRESS = "TennisFriend <reports@mytennisfriends.com>";
const TO_ADDRESS = process.env.REPORT_EMAIL ?? "tennisfriends123@gmail.com";

const Body = z.object({
  courtId: z.string().min(1),
  courtName: z.string().min(1),
  courtAddress: z.string().optional(),
  issue: z.string().min(10).max(2000),
  reporterEmail: z.string().email().optional(),
});

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

  const subject = `Court issue: ${parsed.courtName}`;
  const html = `
    <p><strong>Reported by:</strong> ${profile?.name ?? "(unknown)"} &lt;${parsed.reporterEmail ?? profile?.email ?? "no email"}&gt;</p>
    <p><strong>Court:</strong> ${parsed.courtName} (id: ${parsed.courtId})</p>
    ${parsed.courtAddress ? `<p><strong>Address:</strong> ${parsed.courtAddress}</p>` : ""}
    <p><strong>Issue:</strong></p>
    <p>${parsed.issue.replace(/\n/g, "<br>")}</p>
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
