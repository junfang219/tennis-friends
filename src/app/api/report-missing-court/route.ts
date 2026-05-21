import { NextResponse } from "next/server";
import { Resend } from "resend";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// "I know a court that should be in the catalog but isn't." Same shape
// as report-issue but feeds the curated-court backlog.

const FROM_ADDRESS = "TennisFriend <reports@mytennisfriends.com>";
const TO_ADDRESS = process.env.REPORT_ISSUE_TO ?? "junfang219@gmail.com";

const Body = z.object({
  name: z.string().min(2).max(200),
  address: z.string().min(2).max(400),
  notes: z.string().max(2000).optional(),
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

  const subject = `Missing court: ${parsed.name}`;
  const html = `
    <p><strong>Reported by:</strong> ${profile?.name ?? "(unknown)"} &lt;${parsed.reporterEmail ?? profile?.email ?? "no email"}&gt;</p>
    <p><strong>Name:</strong> ${parsed.name}</p>
    <p><strong>Address:</strong> ${parsed.address}</p>
    ${parsed.notes ? `<p><strong>Notes:</strong><br>${parsed.notes.replace(/\n/g, "<br>")}</p>` : ""}
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
