import { createHmac } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "./route";

const secret = Buffer.from("unit test signing secret");
const emailId = "11111111-1111-4111-8111-111111111111";
const original = "From: Player <player@example.com>\r\nSubject: Login question\r\n\r\nCan you help?";
const downloadUrl = "https://mail.example/original";
const destination = "support-team@example.com";

function receive(to: string, validSignature = true) {
  const payload = JSON.stringify({ type: "email.received", data: { email_id: emailId, to: [to] } });
  const id = "msg_support_test";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret).update(`${id}.${timestamp}.${payload}`).digest("base64");
  return POST(new Request("https://mytennisfriends.com/api/support/inbound", {
    method: "POST",
    headers: {
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": "v1," + (validSignature ? signature : "invalid"),
    },
    body: payload,
  }));
}

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_unit_test");
  vi.stubEnv("RESEND_SUPPORT_WEBHOOK_SECRET", "whsec_" + secret.toString("base64"));
  vi.stubEnv("SUPPORT_FORWARD_TO", destination);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("ignores unsigned delivery attempts and signed mail for other recipients", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  expect((await receive("support@mytennisfriends.com", false)).status).toBe(401);
  expect((await receive("other@mytennisfriends.com")).status).toBe(204);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("forwards the complete original to the configured inbox with a stable idempotency key", async () => {
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({
      from: "Player <player@example.com>",
      subject: "Login question",
      text: "Can you help?",
      raw: { download_url: downloadUrl },
    }))
    .mockResolvedValueOnce(new Response(original))
    .mockResolvedValueOnce(Response.json({ id: "sent" }));
  vi.stubGlobal("fetch", fetchMock);

  expect((await receive("Support <SUPPORT@mytennisfriends.com>")).status).toBe(204);
  expect(fetchMock.mock.calls[0][0]).toBe(`https://api.resend.com/emails/receiving/${emailId}`);
  expect(fetchMock.mock.calls[1][0]).toBe(downloadUrl);
  const [endpoint, send] = fetchMock.mock.calls[2];
  expect(endpoint).toBe("https://api.resend.com/emails");
  expect(new Headers(send?.headers).get("Idempotency-Key")).toBe(`support-forward/${emailId}`);
  expect(JSON.parse(String(send?.body))).toMatchObject({
    to: destination,
    reply_to: "player@example.com",
    subject: "Fwd: Login question",
    attachments: [{ filename: "original-message.eml", content: Buffer.from(original).toString("base64") }],
  });
});
