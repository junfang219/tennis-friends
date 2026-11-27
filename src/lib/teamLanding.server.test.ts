import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readTeamLanding } from "./teamLanding.server";

const mocks = vi.hoisted(() => ({ from: vi.fn(), getUser: vi.fn() }));
vi.mock("./supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: mocks.from, auth: { getUser: mocks.getUser } }),
}));

const groupId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const playerId = "33333333-3333-4333-8333-333333333333";
const matchId = "44444444-4444-4444-8444-444444444444";
const seasonId = "55555555-5555-4555-8555-555555555555";
const ownerMember = "66666666-6666-4666-8666-666666666666";
const playerMember = "77777777-7777-4777-8777-777777777777";

const roster = [
  { id: ownerMember, user_id: ownerId, placeholder_scope: null, roles: [] },
  { id: playerMember, user_id: playerId, placeholder_scope: null, roles: [] },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-26T20:00:00Z"));
  mocks.getUser.mockResolvedValue({ data: { user: { id: ownerId } } });
  mocks.from.mockImplementation((table: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      is: () => query,
      maybeSingle: async () => ({ data: { owner_id: ownerId, group_members: roster }, error: null }),
      or: async () => ({
        data: [{
          id: matchId, match_date: "2026-11-28", match_time: "10:00", timezone: "America/Los_Angeles",
          location: "Green Lake", opponent: "Rally Club", scheduling_status: "fixed", window_end: null,
          season_id: seasonId,
          availabilities: roster.map(member => ({ member_id: member.id, status: "playing", lineup_slot: "" })),
        }], error: null,
      }),
    };
    if (table === "seasons") {
      const data = [
        { id: "other", is_active: true, lineup_format: [{ code: "D1", type: "doubles" }, { code: "D2", type: "doubles" }] },
        { id: seasonId, is_active: false, lineup_format: [{ code: "D1", type: "doubles" }] },
      ];
      return { select: () => ({ eq: async () => ({ data, error: null }) }) };
    }
    if (table === "groups" || table === "team_matches") return query;
    throw new Error(`Unexpected query for ${table}`);
  });
});

afterEach(() => { vi.useRealTimers(); });

it("uses the selected match's season format for the captain's action", async () => {
  await expect(readTeamLanding(groupId)).resolves.toMatchObject({
    role: "Captain", status: "All 2 responded · 2 available",
    action: { label: "Set lineup", href: `/groups/${groupId}/availability?focus=${matchId}` },
  });
});

it("skips match and season reads when the current user is outside the roster", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: { id: "88888888-8888-4888-8888-888888888888" } } });
  await expect(readTeamLanding(groupId)).resolves.toBeNull();
  expect(mocks.from.mock.calls).toEqual([["groups"]]);
});
