import "server-only";
import { z } from "zod";
import { Resend } from "resend";

export function deliveryConfig() {
 return z.object({
  origin:z.url().refine(v=>new URL(v).protocol==="https:"||new URL(v).hostname==="localhost"||new URL(v).hostname==="127.0.0.1"),
  emailKey:z.string().optional(), emailFrom:z.string().optional(),
 }).parse({origin:process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.ONBOARDING_PUBLIC_ORIGIN,emailKey:process.env.RESEND_API_KEY,emailFrom:process.env.ONBOARDING_EMAIL_FROM});
}
export async function deliver(channel:"email",to:string,message:string,subject:string,key:string,config:ReturnType<typeof deliveryConfig>) {
 if(!config.emailKey||!config.emailFrom)throw new Error("Email delivery is not configured");
 const result=await new Resend(config.emailKey).emails.send({from:config.emailFrom,to,subject,text:message},{idempotencyKey:key});
 if(result.error||!result.data)throw new Error("Email provider rejected the message");
 return result.data.id;
}
