import { NextResponse } from "next/server";
import { normalizeE164 } from "@/lib/phone";
import { rateLimit } from "@/lib/rateLimit";

const HOUR = 60 * 60 * 1000;
const twilioConfigured = Boolean(
  process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_VERIFY_SERVICE_SID
);

function ipFromRequest(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: Request) {
  let body: { phone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const e164 = body?.phone ? normalizeE164(body.phone) : null;
  if (!e164) {
    return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
  }

  const ip = ipFromRequest(req);
  const phoneLimit = rateLimit(`otp:phone:${e164}`, 3, HOUR);
  if (!phoneLimit.ok) {
    return NextResponse.json(
      { error: "Too many codes requested for this number. Try again later." },
      { status: 429, headers: { "Retry-After": String(phoneLimit.retryAfterSec) } }
    );
  }
  const ipLimit = rateLimit(`otp:ip:${ip}`, 10, HOUR);
  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: "Too many requests from this IP." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSec) } }
    );
  }

  if (!twilioConfigured) {
    // Dev mode: no SMS sent. Use code "000000" when signing in.
    console.log(`[phone/send] DEV MODE — would send OTP to ${e164}. Use code 000000.`);
    return NextResponse.json({ ok: true, devMode: true });
  }

  try {
    const twilio = (await import("twilio")).default;
    const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
    await client.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID!)
      .verifications.create({ to: e164, channel: "sms" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Twilio Verify error:", err);
    return NextResponse.json({ error: "Failed to send code" }, { status: 502 });
  }
}
