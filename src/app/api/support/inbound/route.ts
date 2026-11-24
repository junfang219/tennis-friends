import { Resend, type WebhookEventPayload } from "resend";
import { z } from "zod";
import { supportEmail } from "@/lib/support";

const configSchema = z.object({
  apiKey: z.string().min(1),
  webhookSecret: z.string().startsWith("whsec_"),
  forwardTo: z.email().refine(email => email.toLowerCase() !== supportEmail),
});

const inboundSchema = z.object({
  email_id: z.uuid(),
  to: z.array(z.string()),
  cc: z.array(z.string()).nullish(),
  bcc: z.array(z.string()).nullish(),
});

const emailSchema = z.object({
  from: z.string(),
  reply_to: z.array(z.string()).nullish(),
  subject: z.string().nullish(),
  text: z.string().nullish(),
  raw: z.object({ download_url: z.url().startsWith("https://") }),
});

function emailAddress(value: string) {
  const trimmed = value.trim();
  return trimmed.match(/<([^<>]+)>$/)?.[1]?.trim() ?? trimmed;
}

export async function POST(request: Request) {
  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (!id || !timestamp || !signature) return new Response(null, { status: 401 });

  const config = configSchema.safeParse({
    apiKey: process.env.RESEND_API_KEY,
    webhookSecret: process.env.RESEND_SUPPORT_WEBHOOK_SECRET,
    forwardTo: process.env.SUPPORT_FORWARD_TO,
  });
  if (!config.success) return new Response(null, { status: 503 });

  const resend = new Resend(config.data.apiKey);
  let event: WebhookEventPayload;
  try {
    event = resend.webhooks.verify({
      payload: await request.text(),
      headers: { id, timestamp, signature },
      webhookSecret: config.data.webhookSecret,
    });
  } catch {
    return new Response(null, { status: 401 });
  }
  if (event?.type !== "email.received") return new Response(null, { status: 204 });

  const inbound = inboundSchema.safeParse(event.data);
  if (!inbound.success) return new Response(null, { status: 400 });
  const { email_id: emailId, to, cc, bcc } = inbound.data;
  if (![...to, ...(cc ?? []), ...(bcc ?? [])].some(value => emailAddress(value).toLowerCase() === supportEmail)) {
    return new Response(null, { status: 204 });
  }

  const received = await resend.emails.receiving.get(emailId);
  const email = emailSchema.safeParse(received.data);
  if (received.error || !email.success) {
    console.error("Could not retrieve the support email from Resend.");
    return new Response(null, { status: 502 });
  }

  const original = email.data;
  let rawMessage: Buffer;
  try {
    const raw = await fetch(original.raw.download_url, { signal: AbortSignal.timeout(15_000) });
    if (!raw.ok) throw new Error("Original email unavailable");
    rawMessage = Buffer.from(await raw.arrayBuffer());
  } catch {
    console.error("Could not download the original support email.");
    return new Response(null, { status: 502 });
  }

  const sender = z.email().safeParse(emailAddress(original.from));
  const replyTo = z.email().safeParse(emailAddress(original.reply_to?.[0] ?? original.from));
  const { error } = await resend.emails.send({
    from: `TennisFriends Support <${supportEmail}>`,
    to: config.data.forwardTo,
    subject: "Fwd: " + (original.subject?.replace(/[\r\n]+/g, " ").slice(0, 200) || "(no subject)"),
    text: [
      "Support message from " + (sender.success ? sender.data : "an unknown sender"),
      original.text?.slice(0, 12_000) || "Open the attached original to read the message.",
    ].join("\n\n"),
    replyTo: replyTo.success ? replyTo.data : undefined,
    attachments: [{
      filename: "original-message.eml",
      contentType: "message/rfc822",
      content: rawMessage.toString("base64"),
    }],
  }, { idempotencyKey: `support-forward/${emailId}` });

  if (error) {
    console.error("Resend could not forward the support email.");
    return new Response(null, { status: 502 });
  }
  return new Response(null, { status: 204 });
}
