import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ from: vi.fn(), getUser: vi.fn(), eq: vi.fn(), is: vi.fn(), in: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: mocks.from, auth: { getUser: mocks.getUser } }),
}));

const viewerId = "11111111-1111-4111-8111-111111111111";
const captainTeam = "22222222-2222-4222-8222-222222222222";
const memberTeam = "33333333-3333-4333-8333-333333333333";
const captainRow = "44444444-4444-4444-8444-444444444444";
const memberRow = "55555555-5555-4555-8555-555555555555";
const otherOwner = "66666666-6666-4666-8666-666666666666";
const request = (query = "") => new Request("http://localhost/api/teams/active" + query);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-26T20:00:00Z"));
  mocks.getUser.mockResolvedValue({ data: { user: { id: viewerId } } });
  mocks.from.mockImplementation((table: string) => {
    if (table === "group_members") return { select: () => ({ eq: mocks.eq }) };
    if (table === "team_matches") return { select: () => ({ in: mocks.in }) };
    throw new Error("Unexpected table");
  });
  mocks.eq.mockReturnValue({ is: mocks.is });
  mocks.is.mockResolvedValue({ data: [
    { id: captainRow, roles: [], team: { id: captainTeam, name: "Sunday Tennis", owner_id: viewerId } },
    { id: memberRow, roles: [], team: { id: memberTeam, name: "Green Lake", owner_id: otherOwner } },
  ], error: null });
  const match = { match_date: "2026-11-28", match_time: "10:00", timezone: "America/Los_Angeles", scheduling_status: "fixed", window_end: null };
  mocks.in.mockReturnValueOnce({ in: mocks.in }).mockReturnValueOnce({ or: async () => ({ data: [
    { ...match, group_id: memberTeam, availabilities: [] },
    { ...match, group_id: memberTeam, availabilities: [{ status: "not_playing" }] },
    { ...match, group_id: memberTeam, match_date: "2026-11-23", availabilities: [] },
    { ...match, group_id: captainTeam, availabilities: [{ status: "maybe" }] },
  ], error: null }) });
});
afterEach(() => vi.useRealTimers());

it("returns account-scoped active memberships, with no match reads at launch", async () => {
  const response = await GET(request());
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ viewerId, teams: [
    { id: memberTeam, name: "Green Lake", role: "Member" },
    { id: captainTeam, name: "Sunday Tennis", role: "Captain" },
  ] });
  expect(mocks.eq).toHaveBeenCalledWith("user_id", viewerId);
  expect(mocks.is).toHaveBeenCalledWith("archived_at", null);
  expect(mocks.from.mock.calls).toEqual([["group_members"]]);
});

it("counts unanswered upcoming matches for the viewer's own memberships", async () => {
  const response = await GET(request("?availability=1"));
  expect((await response.json()).teams).toMatchObject([
    { id: memberTeam, pendingAvailability: 1 },
    { id: captainTeam, pendingAvailability: 0 },
  ]);
  expect(mocks.in).toHaveBeenCalledWith("availabilities.member_id", [captainRow, memberRow]);
});

it("stops before reading memberships for signed-out visitors", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  expect((await GET(request())).status).toBe(401);
  expect(mocks.from).not.toHaveBeenCalled();
});
