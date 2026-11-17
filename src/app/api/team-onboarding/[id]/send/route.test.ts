import { beforeEach, expect, it, vi } from "vitest";
import type { z } from "zod";
import type { storedPlayerSchema } from "@/lib/onboarding/contracts";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), rpc: vi.fn(), from: vi.fn(), deliver: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: mocks.from }),
}));
vi.mock("@/lib/onboarding/delivery", () => ({
  deliver: mocks.deliver,
  deliveryConfig: () => ({ origin: "https://example.com", emailKey: "test", emailFrom: "team@example.com" }),
}));
import { POST } from "./route";

const groupId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
type Player = z.infer<typeof storedPlayerSchema>;
function player(overrides: Partial<Player> = {}): Player {
  return {
    id: "33333333-3333-4333-8333-333333333333", group_id: groupId,
    member_id: "44444444-4444-4444-8444-444444444444", name: "Taylor",
    phone: null, email: "player@example.com", associated_account_id: null,
    associated_account_name: null, accepted_by: accountId, accepted_at: "2026-01-02T00:00:00Z",
    confirmed_at: null, sent_at: "2026-01-01T00:00:00Z", token: "a".repeat(64),
    expires_at: "2000-02-01T00:00:00Z", revoked_at: null, ...overrides,
  };
}
function setPlayers(players: Player[]) {
  mocks.rpc.mockResolvedValue({ data: {
    config: { name: "Test team", includeUsta: true, teamNumber: "1234567890", deadline: "2099-12-01" }, players,
  }, error: null });
}
function request(mode: "prepare" | "email", reminder = true) {
  return POST(new Request("https://example.com/api/send", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, reminder, batchId: "55555555-5555-4555-8555-555555555555" }),
  }), { params: Promise.resolve({ id: groupId }) });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: accountId } } });
  mocks.deliver.mockResolvedValue("provider-id");
  const query = {
    select: vi.fn(), in: vi.fn(), gte: vi.fn(), update: vi.fn(),
    eq: vi.fn(), is: vi.fn(), insert: vi.fn(), single: vi.fn(), error: null,
  };
  for (const name of ["select", "in", "update", "eq", "is", "insert"] as const) {
    query[name].mockReturnValue(query);
  }
  query.gte.mockResolvedValue({ count: 0 });
  query.single.mockResolvedValue({ data: { id: "delivery-id" }, error: null });
  mocks.from.mockReturnValue(query);
  setPlayers([player()]);
});

it("emails a USTA reminder to a joined player after join-link expiry", async () => {
  const response = await request("email");
  expect(await response.json()).toMatchObject({ sent: 1, failed: 0, pending: 0 });
  expect(mocks.deliver).toHaveBeenCalledWith("email", "player@example.com",
    expect.stringContaining("Reminder: please register"), expect.any(String), "delivery-id", expect.any(Object));
});

it("prepares a shareable USTA reminder for a joined player after join-link expiry", async () => {
  const response = await request("prepare");
  expect(await response.json()).toMatchObject({ invitations: [{ name: "Taylor", message: expect.stringContaining("Reminder: please register") }] });
  expect(mocks.deliver).not.toHaveBeenCalled();
});

it.each(["prepare", "email"] as const)("includes a legacy draft's description in %s invitations", async mode => {
  mocks.rpc.mockResolvedValue({ data: {
    config: { name: "Test team", description: "Saturday tennis together", includeDescription: false, includeUsta: false, teamNumber: "", deadline: "" },
    players: [player({ accepted_by: null, accepted_at: null, expires_at: "2099-12-01T00:00:00Z" })],
  }, error: null });
  const response = await request(mode, false);
  expect(response.status).toBe(200);
  if (mode === "prepare") {
    expect(await response.json()).toMatchObject({ invitations: [{ message: expect.stringContaining("Saturday tennis together") }] });
    expect(mocks.deliver).not.toHaveBeenCalled();
  } else {
    expect(await response.json()).toMatchObject({ sent: 1, failed: 0, pending: 0 });
    expect(mocks.deliver).toHaveBeenCalledWith("email", "player@example.com",
      expect.stringContaining("Saturday tennis together"), expect.any(String), "delivery-id", expect.any(Object));
  }
});

it.each(["prepare", "email"] as const)("keeps expired unaccepted invitations blocked in %s mode", async mode => {
  setPlayers([player({ accepted_by: null, accepted_at: null })]);
  const response = await request(mode);
  expect(await response.json()).toMatchObject(mode === "prepare" ? { invitations: [] } : { sent: 0, failed: 1 });
  expect(mocks.deliver).not.toHaveBeenCalled();
});

it.each(["prepare", "email"] as const)("keeps revoked invitations blocked in %s mode", async mode => {
  setPlayers([player({ revoked_at: "2026-01-03T00:00:00Z" })]);
  const response = await request(mode);
  expect(await response.json()).toMatchObject(mode === "prepare" ? { invitations: [] } : { sent: 0, failed: 1 });
  expect(mocks.deliver).not.toHaveBeenCalled();
});

it("does not send USTA reminders to confirmed players", async () => {
  setPlayers([player({ confirmed_at: "2026-01-03T00:00:00Z" })]);
  const response = await request("email");
  expect(response.status).toBe(400);
  expect(mocks.deliver).not.toHaveBeenCalled();
});

it("still rejects an expired joined invitation for a normal invitation email", async () => {
  const response = await request("email", false);
  expect(await response.json()).toMatchObject({ sent: 0, failed: 1 });
  expect(mocks.deliver).not.toHaveBeenCalled();
});

it("emails registration reminders to a shared-link member using their account email", async () => {
  setPlayers([player({ email: null, associated_account_id: accountId, sent_at: null, revoked_at: null })]);
  const deliveryQuery = mocks.from("team_onboarding_deliveries");
  mocks.from.mockImplementation((table: string) => table === "profiles"
    ? { select: () => ({ in: async () => ({ data: [{ id: accountId, email: "shared@example.com" }] }) }) }
    : deliveryQuery);
  const response = await request("email", true);
  expect(await response.json()).toMatchObject({ sent: 1, failed: 0, pending: 0 });
  expect(mocks.deliver).toHaveBeenCalledWith("email", "shared@example.com",
    expect.stringContaining("Reminder: please register"), expect.any(String), "delivery-id", expect.any(Object));
});

it("sends only the selected email recipients and keeps other pending players untouched", async () => {
  const selectedId = "66666666-6666-4666-8666-666666666666";
  setPlayers([player({ id: selectedId, accepted_by: null, expires_at: "2099-12-31T00:00:00Z" }), player({ id: "77777777-7777-4777-8777-777777777777", email: "other@example.com", accepted_by: null, expires_at: "2099-12-31T00:00:00Z" })]);
  const response = await POST(new Request("https://example.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "email", reminder: false, batchId: "55555555-5555-4555-8555-555555555555", playerIds: [selectedId] }) }), { params: Promise.resolve({ id: groupId }) });
  expect(await response.json()).toMatchObject({ sent: 1 }); expect(mocks.deliver).toHaveBeenCalledTimes(1);
});
it("an email instruction opt-out preserves separate USTA tracking", async () => {
  mocks.rpc.mockResolvedValue({ data: { config: { name: "Test team", includeUsta: true, includeUstaInInvitations: false, teamNumber: "0000000000", deadline: "2099-12-01" }, players: [player({ expires_at: "2099-12-31T00:00:00Z" })] }, error: null });
  await request("email", false);
  expect(mocks.deliver.mock.calls[0][2]).not.toContain("USTA team:");
  mocks.deliver.mockClear(); await request("email", true);
  expect(mocks.deliver.mock.calls[0][2]).toContain("USTA team:");
});
