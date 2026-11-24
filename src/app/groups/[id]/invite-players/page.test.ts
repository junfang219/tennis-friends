import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), from: vi.fn(), rpc: vi.fn(), fetch: vi.fn(),
  redirect: vi.fn((url: string): never => { throw new Error(`redirect:${url}`); }),
  notFound: vi.fn((): never => { throw new Error("not-found"); }),
  router: { replace: vi.fn(), refresh: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router, redirect: mocks.redirect, notFound: mocks.notFound }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser }, from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/browser", () => ({ createSupabaseBrowserClient: () => { throw new Error("Unexpected browser database access during server rendering"); } }));
vi.mock("twilio", () => { throw new Error("Invitation rendering must not load the SMS delivery SDK"); });
vi.mock("resend", () => { throw new Error("Invitation rendering must not load the email delivery SDK"); });

// These are the real page, teamPage, server loaders, hook, and invitation editor.
// Only framework navigation and external service boundaries are controlled.
import InvitePlayersPage from "./page";
const id = "33333333-3333-4333-8333-333333333333";
const owner = "11111111-1111-4111-8111-111111111111";
const manager = "22222222-2222-4222-8222-222222222222";
const playerId = "44444444-4444-4444-8444-444444444444";
const saved = {
  config: { name: "Old stored name", description: "Real route description", invitationMessage: "Server-loaded invitation message", includeUsta: false, teamNumber: "", deadline: "" },
  players: [{ id: playerId, group_id: id, member_id: playerId, name: "Server-loaded player", phone: "+12065550101", email: null, associated_account_id: null, associated_account_name: null, accepted_by: null, accepted_at: null, confirmed_at: null, sent_at: null, token: "c".repeat(64), expires_at: "2099-12-31T00:00:00Z", revoked_at: null }],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_TEAM_ONBOARDING_ENABLED", "true");
  vi.stubEnv("ONBOARDING_PUBLIC_ORIGIN", "https://example.com");
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC" + "a".repeat(32));
  vi.stubEnv("TWILIO_AUTH_TOKEN", "test-secret-that-must-stay-server-only");
  vi.stubEnv("TWILIO_MESSAGING_SERVICE_SID", "MG" + "b".repeat(32));
  mocks.getUser.mockResolvedValue({ data: { user: { id: owner, email: "captain@example.com" } } });
  mocks.rpc.mockResolvedValue({ data: structuredClone(saved), error: null });
  mocks.fetch.mockRejectedValue(new Error("The ready page must not need a browser API read"));
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.from.mockImplementation((table: string) => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id, name: "Current route team", owner_id: owner, member_types: [] }, error: null }),
      is: () => query,
      order: vi.fn(),
      gt: async () => ({ data: [], error: null }) };
    query.order.mockReturnValueOnce(query).mockResolvedValue({ data: [{ id: manager, user_id: manager, roles: ["manager"], member_type: "", placeholder_name: null, user: { id: manager, name: "Manager", profile_image_url: null } }], error: null });
    if (!["groups", "group_members", "group_invites"].includes(table)) throw new Error(`Unexpected table: ${table}`);
    return query;
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const openPage = () => InvitePlayersPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ setup: "1" }) });

it("renders the real Invite players page ready from its server snapshot", async () => {
  const html = renderToString(await openPage());
  // Removing initialState from page.tsx must fail these behavioral assertions.
  expect(html).toContain('type="tel"');
  expect(html).toContain("Server-loaded player");
  expect(html).toContain("Server-loaded invitation message");
  expect(html).toContain("Current route team");
  expect(html).toContain("Send invitations &amp; finish");
  expect(html).not.toContain("Loading invitations");
  expect(html).not.toContain("test-secret-that-must-stay-server-only");
  expect(mocks.getUser).toHaveBeenCalledTimes(1);
  expect(mocks.from.mock.calls.map(call => call[0]).sort()).toEqual(["group_invites", "group_members", "groups"]);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("read_team_onboarding", { p_group: id });
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it("renders the ready form for a non-owner manager through the real permission checks", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: { id: manager, email: "manager@example.com" } } });
  const html = renderToString(await openPage());
  expect(html).toContain('type="tel"');
  expect(html).not.toContain("Loading invitations");
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it.each([
  { from: "settings", destination: "settings?tab=roster" },
  { from: "https://example.test", destination: "roster" },
])("uses the expected return link for invitation origin $from", async ({ from, destination }) => {
  const html = renderToString(await InvitePlayersPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ from }) }));
  expect(html).toContain(`href="/groups/${id}/${destination}"`);
  expect(html).toContain("Back to roster");
});

it("does not return invitation content when the server RPC denies current manager access", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
  await expect(openPage()).rejects.toThrow("not-found");
  expect(mocks.notFound).toHaveBeenCalledTimes(1);
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it("redirects signed-out visitors before reading any invitation data", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  await expect(openPage()).rejects.toThrow("redirect:");
  expect(mocks.redirect).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(`/groups/${id}/invite-players`)}`);
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
