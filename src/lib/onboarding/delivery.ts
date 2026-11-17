import "server-only";
import { z } from "zod";
import { Resend } from "resend";
import twilio from "twilio";

export class DeliveryError extends Error {
 constructor(message: string, readonly outcome: "failed" | "unknown") { super(message); }
}
export function deliveryConfig() {
 return z.object({
  origin:z.url().refine(v=>new URL(v).protocol==="https:"||new URL(v).hostname==="localhost"||new URL(v).hostname==="127.0.0.1"),
  emailKey:z.string().optional(), emailFrom:z.string().optional(),
  smsAccount:z.string().optional(), smsToken:z.string().optional(), smsService:z.string().optional(), smsFrom:z.string().optional(),
 }).parse({origin:process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.ONBOARDING_PUBLIC_ORIGIN,emailKey:process.env.RESEND_API_KEY,emailFrom:process.env.ONBOARDING_EMAIL_FROM,
  smsAccount:process.env.TWILIO_ACCOUNT_SID,smsToken:process.env.TWILIO_AUTH_TOKEN,smsService:process.env.TWILIO_MESSAGING_SERVICE_SID,smsFrom:process.env.TWILIO_FROM_NUMBER});
}
export function smsConfiguration(config: ReturnType<typeof deliveryConfig>) {
 return z.object({smsAccount:z.string().regex(/^AC[0-9a-fA-F]{32}$/),smsToken:z.string().min(1),smsService:z.string().regex(/^MG[0-9a-fA-F]{32}$/).optional(),smsFrom:z.string().regex(/^\+[1-9]\d{7,14}$/).optional()})
  .refine(c=>Boolean(c.smsService||c.smsFrom)).safeParse({...config,smsService:config.smsService||undefined,smsFrom:config.smsFrom||undefined});
}
export function smsText(message: string) { return `TennisFriends\n${message}\n\nReply STOP to opt out.`; }
export async function deliver(channel:"email"|"sms",to:string,message:string,subject:string,key:string,config:ReturnType<typeof deliveryConfig>) {
 if(channel === "sms") {
  const parsed=smsConfiguration(config);
  if(!parsed.success)throw new DeliveryError("SMS delivery is not configured", "failed");
  const c=parsed.data;
  try {
   // Twilio message creation has no provider idempotency key. Claim the database
   // delivery first; never automatically retry a timed-out POST.
   const result=await twilio(c.smsAccount,c.smsToken,{autoRetry:false,timeout:15000}).messages.create({to,body:smsText(message),...(c.smsService?{messagingServiceSid:c.smsService}:{from:c.smsFrom})});
   if(!z.object({sid:z.string().regex(/^SM[0-9a-fA-F]{32}$/),status:z.enum(["accepted","queued","sending","sent","delivered","failed","undelivered","canceled"])}).safeParse(result).success)throw new DeliveryError("SMS acceptance could not be confirmed", "unknown");
   if(["failed","undelivered","canceled"].includes(result.status))throw new DeliveryError("SMS provider rejected the message", "failed");
   return result.sid;
  } catch(error) {
   if(error instanceof DeliveryError)throw error;
   const rejected=z.object({status:z.number().int().min(400).max(499)}).safeParse(error);
   throw new DeliveryError(rejected.success?"SMS provider rejected the message":"SMS acceptance is unknown; review before retrying",rejected.success?"failed":"unknown");
  }
 }
 if(!config.emailKey||!config.emailFrom)throw new Error("Email delivery is not configured");
 const result=await new Resend(config.emailKey).emails.send({from:config.emailFrom,to,subject,text:message},{idempotencyKey:key});
 if(result.error||!result.data)throw new Error("Email provider rejected the message");
 return result.data.id;
}
