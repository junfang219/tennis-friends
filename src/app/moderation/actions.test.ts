import { beforeEach, expect, it, vi } from "vitest";
import { decideContentReport } from "./actions";

const mocked = vi.hoisted(() => ({
  auth: vi.fn(), admin: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: mocked.auth } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocked.admin }));
vi.mock("next/cache", () => ({ revalidatePath: mocked.revalidate }));

const staffId = "11111111-1111-4111-8111-111111111111";
const reportId = "22222222-2222-4222-8222-222222222222";
const initial = { error: "", message: "" };

function review(decision: string) {
  const form = new FormData();
  form.set("reportId", reportId);
  form.set("decision", decision);
  return decideContentReport(initial, form);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocked.auth.mockResolvedValue({ data: { user: { id: staffId, app_metadata: { content_moderator: true } } } });
  mocked.admin.mockReturnValue({ rpc: mocked.rpc });
  mocked.rpc.mockResolvedValue({ data: true, error: null });
});

it("requires staff access from trusted metadata on every action", async () => {
  mocked.auth.mockResolvedValue({ data: { user: { id: staffId, app_metadata: {}, user_metadata: { content_moderator: true } } } });
  expect((await review("removed")).error).toMatch(/access/);
  expect(mocked.admin).not.toHaveBeenCalled();
});

it("validates decisions and uses the authenticated staff ID for the removal", async () => {
  expect((await review("arbitrary")).error).toMatch(/decision/);
  expect(mocked.admin).not.toHaveBeenCalled();
  expect(await review("removed")).toEqual({ error: "", message: "Decision saved." });
  expect(mocked.rpc).toHaveBeenCalledExactlyOnceWith("review_content_report", {
    p_report_id: reportId, p_reviewer_id: staffId, p_decision: "removed",
  });
  expect(mocked.revalidate).toHaveBeenCalledWith("/moderation");
});
