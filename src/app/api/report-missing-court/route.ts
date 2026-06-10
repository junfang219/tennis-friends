import { NextResponse } from "next/server";
import { Resend } from "resend";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// "I know a court that should be in the catalog but isn't." Same shape
// as report-issue but feeds the curated-court backlog.

const FROM_ADDRESS = "TennisFriend <reports@mytennisfriends.com>";
const TO_ADDRESS = process.env.REPORT_EMAIL ?? "tennisfriends123@gmail.com";

const Body = z
  .object({
    courtName: z.string().min(2).max(200).optional(),
    address: z.string().min(2).max(400).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    courtCount: z.number().int().min(1).max(50).optional(),
    indoorOutdoor: z.enum(["outdoor", "indoor", "both"]).optional(),
    managedBy: z.enum(["city", "club", "school", "other"]).optional(),
    notes: z.string().max(2000).optional(),
    reporterEmail: z.string().email().optional(),
  })
  .refine(
    (v) => (v.latitude != null && v.longitude != null) || (v.address && v.address.trim().length > 0),
    { message: "Provide either an address or latitude/longitude" }
  );

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

  const locationLine =
    parsed.latitude != null && parsed.longitude != null
      ? `${parsed.latitude.toFixed(6)}, ${parsed.longitude.toFixed(6)} ` +
        `(<a href="https://www.google.com/maps?q=${parsed.latitude},${parsed.longitude}">map</a>)`
      : escapeHtml(parsed.address ?? "");

  const subject = parsed.courtName
    ? `Missing court: ${parsed.courtName}`
    : "Missing court (unnamed)";
  const html = `
    <p><strong>Reported by:</strong> ${escapeHtml(profile?.name ?? "(unknown)")} &lt;${escapeHtml(parsed.reporterEmail ?? profile?.email ?? "no email")}&gt;</p>
    ${parsed.courtName ? `<p><strong>Name:</strong> ${escapeHtml(parsed.courtName)}</p>` : "<p><em>(No court name provided)</em></p>"}
    <p><strong>Location:</strong> ${locationLine}</p>
    ${parsed.courtCount != null ? `<p><strong>Courts:</strong> ${parsed.courtCount}</p>` : ""}
    ${parsed.indoorOutdoor ? `<p><strong>Indoor/Outdoor:</strong> ${escapeHtml(parsed.indoorOutdoor)}</p>` : ""}
    ${parsed.managedBy ? `<p><strong>Managed by:</strong> ${escapeHtml(parsed.managedBy)}</p>` : ""}
    ${parsed.notes ? `<p><strong>Notes:</strong><br>${escapeHtml(parsed.notes).replace(/\n/g, "<br>")}</p>` : ""}
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
