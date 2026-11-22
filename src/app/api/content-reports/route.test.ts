import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocked = vi.hoisted(() => ({
  user: vi.fn(),
  read: vi.fn(),
  admin: vi.fn(),
  rpc: vi.fn(),
  after: vi.fn(),
  block: vi.fn(),
}));

vi.mock("next/server", async (original) => ({
  ...await original<typeof import("next/server")>(),
  after: mocked.after,
}));
vi.mock("@/lib/moderation/server", () => ({
  readReportEvidence: mocked.read,
  reviewableMediaUrl: (url: string) => url.startsWith("https://storage.example/") ? url : null,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: mocked.user } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocked.admin }));
vi.mock("@/lib/supabase/queries/friends", () => ({ blockUser: mocked.block }));

const reporter = "11111111-1111-4111-8111-111111111111";
const author = "22222222-2222-4222-8222-222222222222";
const message = "33333333-3333-4333-8333-333333333333";
const report = { targetType: "direct_message", targetId: message, reason: "harassment" };

function submit(body: unknown = report, contentType = "application/json") {
  return POST(new Request("http://localhost/api/content-reports", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocked.user.mockResolvedValue({ data: { user: { id: reporter } } });
  mocked.admin.mockReturnValue({ rpc: mocked.rpc });
  mocked.read.mockResolvedValue({
    authorId: author,
    content: "Reported text",
    media: ["https://storage.example/image.png", "https://untrusted.example/image.png"],
  });
  mocked.rpc.mockResolvedValue({ data: "created", error: null });
});

afterEach(() => vi.unstubAllEnvs());

describe("submitting content reports", () => {
  it("reads evidence as the signed-in reporter, then records only trusted evidence", async () => {
    const response = await submit({ ...report, details: "  A detail  ", blockAuthor: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, duplicate: false, blockFailed: false, blockedAuthorId: author });
    expect(mocked.read).toHaveBeenCalledWith({ auth: { getUser: mocked.user } }, "direct_message", message);
    expect(mocked.rpc).toHaveBeenCalledExactlyOnceWith("record_content_report", {
      p_reporter_id: reporter, p_author_id: author, p_target_type: "direct_message", p_target_id: message,
      p_reason: "harassment", p_details: "A detail", p_evidence_text: "Reported text",
      p_evidence_media: ["https://storage.example/image.png"],
    });
    expect(mocked.block).toHaveBeenCalledWith({ auth: { getUser: mocked.user } }, author);
    expect(mocked.after).toHaveBeenCalledTimes(1);
  });

  it("rejects unauthorized targets, self-reports, and unauthenticated submissions before using elevated access", async () => {
    mocked.read.mockResolvedValueOnce(null).mockResolvedValueOnce({ authorId: reporter, content: "", media: [] });
    expect((await submit()).status).toBe(404);
    expect((await submit()).status).toBe(400);
    mocked.user.mockResolvedValueOnce({ data: { user: null } });
    expect((await submit()).status).toBe(401);
    expect(mocked.read).toHaveBeenCalledTimes(2);
    expect(mocked.admin).not.toHaveBeenCalled();
  });

  it("rejects spoofed evidence, missing details for other, and untrusted form content types", async () => {
    expect((await submit({ ...report, evidence: "fake" })).status).toBe(400);
    expect((await submit({ ...report, reason: "other" })).status).toBe(400);
    expect((await submit(report, "text/plain")).status).toBe(415);
    expect(mocked.read).not.toHaveBeenCalled();
  });

  it("does not notify moderators twice or conceal an unsuccessful block", async () => {
    mocked.rpc.mockResolvedValue({ data: "duplicate", error: null });
    mocked.block.mockRejectedValue(new Error("failure"));
    const response = await submit({ ...report, blockAuthor: true });
    expect(await response.json()).toEqual({ ok: true, duplicate: true, blockFailed: true, blockedAuthorId: null });
    expect(mocked.after).not.toHaveBeenCalled();
  });

  it("reports throttling without changing the block list", async () => {
    mocked.rpc.mockResolvedValue({ data: "rate_limited", error: null });
    expect((await submit({ ...report, blockAuthor: true })).status).toBe(429);
    expect(mocked.block).not.toHaveBeenCalled();
    expect(mocked.after).not.toHaveBeenCalled();
  });

  it("passes the complete evidence text so the database can identify changes beyond the excerpt", async () => {
    const content = "a".repeat(4000) + "edited";
    mocked.read.mockResolvedValue({ authorId: author, content, media: [] });
    expect((await submit()).status).toBe(200);
    expect(mocked.rpc).toHaveBeenCalledWith("record_content_report", expect.objectContaining({ p_evidence_text: content }));
  });
});
