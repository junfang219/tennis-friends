import { beforeEach,afterEach,it,expect,vi } from "vitest";
const mocks=vi.hoisted(()=>({email:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("resend",()=>({Resend:class {emails={send:mocks.email};}}));
import { deliver,deliveryConfig } from "./delivery";
beforeEach(()=>{vi.stubEnv("ONBOARDING_PUBLIC_ORIGIN","https://example.com");vi.stubEnv("RESEND_API_KEY","test");vi.stubEnv("ONBOARDING_EMAIL_FROM","teams@example.com");mocks.email.mockReset();});
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
