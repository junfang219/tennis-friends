import { beforeEach, expect, it, vi } from "vitest";
import { saveMatchLineupSlot, saveMatchResponse } from "./actions";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), upsert: vi.fn(), save: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser }, from: () => ({ upsert: mocks.upsert }) }),
}));

const teamId = "11111111-1111-4111-8111-111111111111";
const input = {
  matchId: "22222222-2222-4222-8222-222222222222",
  memberId: "33333333-3333-4333-8333-333333333333",
  userId: null,
  status: "playing",
  matchTypes: "doubles",
};
const saved = {
  id: "44444444-4444-4444-8444-444444444444",
  member_id: input.memberId, user_id: null, status: input.status, match_types: input.matchTypes, lineup_slot: "D1",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "55555555-5555-4555-8555-555555555555" } } });
  mocks.upsert.mockReturnValue({ select: () => ({ single: mocks.save }) });
});

it("invalidates the saved match's team overview and preserves the response row", async () => {
  mocks.save.mockResolvedValue({ data: { ...saved, team_matches: { group_id: teamId } }, error: null });
  expect(await saveMatchResponse(input)).toEqual({ response: saved });
  expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
    match_id: input.matchId, member_id: input.memberId, user_id: null, status: "playing",
  }), { onConflict: "match_id,member_id" });
  expect(mocks.revalidatePath).toHaveBeenCalledWith(`/groups/${teamId}`);
});

it("leaves the team overview alone if the RSVP is rejected", async () => {
  mocks.save.mockResolvedValue({ data: null, error: { message: "Response update denied" } });
  expect(await saveMatchResponse(input)).toEqual({ error: "Response update denied" });
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
});

it.each(["D1", ""])("revalidates after setting the lineup slot to %j and preserves the RSVP", async (slot) => {
  const response = { ...saved, lineup_slot: slot };
  mocks.save.mockResolvedValue({ data: { ...response, team_matches: { group_id: teamId } }, error: null });
  expect(await saveMatchLineupSlot({ matchId: input.matchId, memberId: input.memberId, userId: null, slot }))
    .toEqual({ response });
  expect(mocks.upsert).toHaveBeenCalledWith({
    event_kind: "match", match_id: input.matchId, member_id: input.memberId, user_id: null, lineup_slot: slot,
  }, { onConflict: "match_id,member_id" });
  expect(mocks.revalidatePath).toHaveBeenCalledWith(`/groups/${teamId}`);
});

it("leaves the team overview alone if the lineup save is rejected", async () => {
  mocks.save.mockResolvedValue({ data: null, error: { message: "Lineup update denied" } });
  expect(await saveMatchLineupSlot({ matchId: input.matchId, memberId: input.memberId, userId: null, slot: "D1" }))
    .toEqual({ error: "Lineup update denied" });
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
});
