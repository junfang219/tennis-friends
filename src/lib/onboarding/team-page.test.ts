import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), group: vi.fn(), members: vi.fn(), management: vi.fn(), redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }), notFound: vi.fn(() => { throw new Error("not-found"); }) }));
vi.mock("./management-data", async importOriginal => ({ ...await importOriginal<typeof import("./management-data")>(), readTeamManagement: mocks.management }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("./roster-data", () => ({ readTeamRoster: async () => { const g = await mocks.group(); return g ? { id: g.id, name: g.name, ownerId: g.owner_id, memberTypes: [], members: (await mocks.members()).map((m: { id: string; user_id: string; roles: ("manager" | "captain")[]; member_type: string; isPlaceholder: boolean; user: { id: string; name: string; profile_image_url: string } }) => ({ id: m.id, userId: m.user_id, roles: m.roles, memberType: m.member_type, isPlaceholder: m.isPlaceholder, user: { id: m.user.id, name: m.user.name, profileImageUrl: m.user.profile_image_url } })) } : null; } }));
import { teamPage } from "./team-page";
import { TeamManagementReadError } from "./management-data";
const id = "33333333-3333-4333-8333-333333333333", owner = "11111111-1111-4111-8111-111111111111", memberId = "44444444-4444-4444-8444-444444444444";
function member(roles: string[] = []) { return { id: memberId, user_id: memberId, roles, member_type: "", isPlaceholder: false, user: { id: memberId, name: "Member", profile_image_url: "" } }; }
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_TEAM_ONBOARDING_ENABLED", "true"); mocks.getUser.mockResolvedValue({ data: { user: { id: owner, email: "captain@example.com" } } }); mocks.group.mockResolvedValue({ id, name: "Team", owner_id: owner, member_types: [] }); mocks.members.mockResolvedValue([]); mocks.management.mockResolvedValue({ config: { name: "Team", includeUsta: false, teamNumber: "", deadline: "" }, players: [], members: [], legacyInvitations: [] }); });
it("the owner can open the Roster and invite screens before adding any players", async () => { expect((await teamPage(id, "roster")).group.members).toEqual([]); expect((await teamPage(id, "invite-players")).group.id).toBe(id); });
it("ordinary members can view Roster without gaining invitation management", async () => { mocks.getUser.mockResolvedValue({ data: { user: { id: memberId } } }); mocks.members.mockResolvedValue([member()]); expect((await teamPage(id, "roster")).currentUser.id).toBe(memberId); await expect(teamPage(id, "invite-players")).rejects.toThrow("not-found"); await expect(teamPage(id, "registration")).rejects.toThrow("not-found"); await expect(teamPage(id, "setup-details")).rejects.toThrow("not-found"); });
it("managers can use both management sections", async () => { mocks.getUser.mockResolvedValue({ data: { user: { id: memberId } } }); mocks.members.mockResolvedValue([member(["manager"])]); expect((await teamPage(id, "invite-players")).group.id).toBe(id); expect((await teamPage(id, "registration")).group.id).toBe(id); });
it("an operations-only captain does not acquire manager access", async () => { mocks.getUser.mockResolvedValue({ data: { user: { id: memberId } } }); mocks.members.mockResolvedValue([member(["captain"])]); await expect(teamPage(id, "invite-players")).rejects.toThrow("not-found"); });
it("outsiders cannot read the roster even if a group lookup returns its name", async () => { mocks.getUser.mockResolvedValue({ data: { user: { id: memberId } } }); await expect(teamPage(id, "roster")).rejects.toThrow("not-found"); });
it("signed-out users return to the correct Roster route after login", async () => { mocks.getUser.mockResolvedValue({ data: { user: null } }); await expect(teamPage(id, "roster")).rejects.toThrow("redirect:"); expect(mocks.redirect).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(`/groups/${id}/roster`)}`); });
it("invalid team IDs fail before any database access", async () => { await expect(teamPage("bad", "roster")).rejects.toThrow("not-found"); expect(mocks.getUser).not.toHaveBeenCalled(); });

it("only managers can return to the saved setup details", async () => { expect((await teamPage(id, "setup-details")).group.id).toBe(id); mocks.getUser.mockResolvedValue({ data: { user: { id: memberId } } }); mocks.members.mockResolvedValue([member(["manager"])]); expect((await teamPage(id, "setup-details")).group.id).toBe(id); });

it("loads the authorized invitation snapshot with one auth check and one roster lookup", async () => {
  const result = await teamPage(id, "invite-players");
  expect(result.initialManagement).toMatchObject({ config: { name: "Team" }, players: [] });
  expect(mocks.getUser).toHaveBeenCalledTimes(1); expect(mocks.group).toHaveBeenCalledTimes(1); expect(mocks.members).toHaveBeenCalledTimes(1);
  expect(mocks.management).toHaveBeenCalledTimes(1);
});
it("does not prefetch manager data on the ordinary roster page or before sign-in", async () => {
  await teamPage(id, "roster"); expect(mocks.management).not.toHaveBeenCalled();
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  await expect(teamPage(id, "invite-players")).rejects.toThrow("redirect:"); expect(mocks.management).not.toHaveBeenCalled();
});
it("does not expose a snapshot if the manager RPC denies current access", async () => {
  mocks.management.mockRejectedValue(new TeamManagementReadError("Team manager access required", 403));
  await expect(teamPage(id, "invite-players")).rejects.toThrow("not-found");
});
