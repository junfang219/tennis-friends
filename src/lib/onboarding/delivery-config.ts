import "server-only";
import { z } from "zod";

export function deliveryConfig() {
 return z.object({
  origin:z.url().refine(v=>new URL(v).protocol==="https:"||new URL(v).hostname==="localhost"||new URL(v).hostname==="127.0.0.1"),
  emailKey:z.string().optional(), emailFrom:z.string().optional(),
  smsAccount:z.string().optional(), smsToken:z.string().optional(), smsService:z.string().optional(), smsFrom:z.string().optional(), smsOrigin:z.string().optional(),
 }).parse({origin:process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.ONBOARDING_PUBLIC_ORIGIN,emailKey:process.env.RESEND_API_KEY,emailFrom:process.env.ONBOARDING_EMAIL_FROM,
  smsAccount:process.env.TWILIO_ACCOUNT_SID,smsToken:process.env.TWILIO_AUTH_TOKEN,smsService:process.env.TWILIO_MESSAGING_SERVICE_SID,smsFrom:process.env.TWILIO_FROM_NUMBER,smsOrigin:process.env.ONBOARDING_SMS_PUBLIC_ORIGIN});
}
export function smsConfiguration(config: ReturnType<typeof deliveryConfig>) {
 return z.object({smsAccount:z.string().regex(/^AC[0-9a-fA-F]{32}$/),smsToken:z.string().min(1),smsService:z.string().regex(/^MG[0-9a-fA-F]{32}$/).optional(),smsFrom:z.string().regex(/^\+[1-9]\d{7,14}$/).optional()})
  .refine(c=>Boolean(c.smsService||c.smsFrom)).safeParse({...config,smsService:config.smsService||undefined,smsFrom:config.smsFrom||undefined});
}
export function smsInvitationOrigin(config: ReturnType<typeof deliveryConfig>) {
 return z.url().pipe(z.string().refine(value => { const url = new URL(value); return url.protocol === "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname); })).safeParse(config.smsOrigin || config.origin);
}
export function smsReadiness() {
 try { const config = deliveryConfig(); return { configured: smsConfiguration(config).success, publicOrigin: smsInvitationOrigin(config).success }; }
 catch { return { configured: false, publicOrigin: false }; }
}
