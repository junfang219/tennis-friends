import { beforeEach,afterEach,it,expect,vi } from "vitest";
const mocks=vi.hoisted(()=>({email:vi.fn(),sms:vi.fn(),client:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("resend",()=>({Resend:class {emails={send:mocks.email};}}));
vi.mock("twilio",()=>({default:mocks.client}));
import { deliver,deliveryConfig,DeliveryError } from "./delivery";
beforeEach(()=>{vi.stubEnv("ONBOARDING_PUBLIC_ORIGIN","https://example.com");vi.stubEnv("RESEND_API_KEY","test");vi.stubEnv("ONBOARDING_EMAIL_FROM","teams@example.com");mocks.email.mockReset();mocks.sms.mockReset();mocks.client.mockReturnValue({messages:{create:mocks.sms}});});
afterEach(()=>vi.unstubAllEnvs());
it("does not require Twilio credentials",()=>{
 vi.stubEnv("TWILIO_ACCOUNT_SID","");vi.stubEnv("TWILIO_AUTH_TOKEN","");
 expect(deliveryConfig().origin).toBe("https://example.com");
});
it("passes idempotency keys to email and propagates rejection",async()=>{
 mocks.email.mockResolvedValue({data:{id:"email-123"},error:null});
 expect(await deliver("email","player@example.com","Invitation","Team","stable-key",deliveryConfig())).toBe("email-123");
 expect(mocks.email).toHaveBeenCalledWith(expect.anything(),{idempotencyKey:"stable-key"});
 mocks.email.mockResolvedValue({data:null,error:{message:"rejected"}});
 await expect(deliver("email","player@example.com","Invitation","Team","stable-key",deliveryConfig())).rejects.toThrow("rejected");
});
it("does not fake success when email is unconfigured",async()=>{
 const config=deliveryConfig();
 await expect(deliver("email","player@example.com","Invitation","Team","key",{...config,emailKey:""})).rejects.toThrow("not configured");
 expect(mocks.email).not.toHaveBeenCalled();
});

it("uses the deployment origin for preview invitation links",()=>{
 vi.stubEnv("VERCEL_ENV","preview");
 vi.stubEnv("VERCEL_URL","tennisfriend-phone-test.vercel.app");
 expect(deliveryConfig().origin).toBe("https://tennisfriend-phone-test.vercel.app");
});

const smsConfig = () => ({...deliveryConfig(),smsAccount:"AC"+"a".repeat(32),smsToken:"test-token",smsService:"MG"+"b".repeat(32)});
it("sends a real Twilio message with branding, opt-out and automatic retries disabled",async()=>{
 mocks.sms.mockResolvedValue({sid:"SM"+"c".repeat(32),status:"queued"});
 expect(await deliver("sms","+12065550101","Personal invitation","Team","db-claim",smsConfig())).toBe("SM"+"c".repeat(32));
 expect(mocks.client).toHaveBeenCalledWith("AC"+"a".repeat(32),"test-token",{autoRetry:false,timeout:15000});
 expect(mocks.sms).toHaveBeenCalledWith({to:"+12065550101",messagingServiceSid:"MG"+"b".repeat(32),body:expect.stringMatching(/^TennisFriends\nPersonal invitation[\s\S]*Reply STOP to opt out\.$/)});
 expect(mocks.email).not.toHaveBeenCalled();
});
it("supports an SMS sender number without a Messaging Service",async()=>{
 mocks.sms.mockResolvedValue({sid:"SM"+"c".repeat(32),status:"accepted"});
 await deliver("sms","+12065550101","Invitation","Team","claim",{...smsConfig(),smsService:undefined,smsFrom:"+12065550102"});
 expect(mocks.sms.mock.calls[0][0]).toMatchObject({from:"+12065550102"});
 expect(mocks.sms.mock.calls[0][0]).not.toHaveProperty("messagingServiceSid");
});
it("does not call Twilio or fake success when the SMS sender is missing",async()=>{
 await expect(deliver("sms","+12065550101","Invitation","Team","claim",{...smsConfig(),smsService:undefined,smsFrom:undefined})).rejects.toMatchObject({outcome:"failed"});
 expect(mocks.sms).not.toHaveBeenCalled();
});
it.each([400,401,429])("classifies explicit provider rejection %s as failed",async status=>{
 mocks.sms.mockRejectedValue({status});await expect(deliver("sms","+12065550101","Invitation","Team","claim",smsConfig())).rejects.toMatchObject({outcome:"failed"});
});
it.each([new Error("timeout"),{status:503},{}])("keeps uncertain SMS acceptance pending",async error=>{
 mocks.sms.mockRejectedValue(error);await expect(deliver("sms","+12065550101","Invitation","Team","claim",smsConfig())).rejects.toMatchObject({outcome:"unknown"});expect(mocks.sms).toHaveBeenCalledTimes(1);
});
it("rejects a malformed provider response without pretending the text was accepted",async()=>{
 mocks.sms.mockResolvedValue({sid:"",status:"queued"});await expect(deliver("sms","+12065550101","Invitation","Team","claim",smsConfig())).rejects.toBeInstanceOf(DeliveryError);
});
