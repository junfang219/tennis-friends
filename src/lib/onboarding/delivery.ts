import "server-only";
import { z } from "zod";
import { Resend } from "resend";
import twilio from "twilio";
import { deliveryConfig, smsConfiguration } from "./delivery-config";
export { deliveryConfig, smsConfiguration, smsInvitationOrigin, smsReadiness } from "./delivery-config";

export class DeliveryError extends Error {
 constructor(message: string, readonly outcome: "failed" | "unknown") { super(message); }
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
