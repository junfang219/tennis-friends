import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), from: vi.fn(), group: { owner_id: "11111111-1111-4111-8111-111111111111" }, member: { id: "44444444-4444-4444-8444-444444444444", user_id: "55555555-5555-4555-8555-555555555555" as string | null, roles: [] as string[] }, update: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc, from: mocks.from }) }));
import { PATCH, DELETE } from "./route";
const id = "33333333-3333-4333-8333-333333333333", memberId = "44444444-4444-4444-8444-444444444444";
const request = (body: unknown) => PATCH(new Request("https://example.com", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.group.owner_id = "11111111-1111-4111-8111-111111111111"; mocks.member.user_id = "55555555-5555-4555-8555-555555555555"; mocks.member.roles = [];
  mocks.getUser.mockResolvedValue({ data: { user: { id: mocks.group.owner_id } } }); mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.from.mockImplementation((table: string) => { const q = { select: vi.fn(), eq: vi.fn(), single: vi.fn(), update: mocks.update, delete: mocks.remove, error: null }; q.select.mockReturnValue(q); q.eq.mockReturnValue(q); mocks.update.mockReturnValue(q); mocks.remove.mockReturnValue(q); q.single.mockImplementation(async () => ({ data: table === "groups" ? mocks.group : mocks.member, error: null })); return q; });
});
it("requires authenticated manager access", async () => { mocks.getUser.mockResolvedValue({ data: { user: null } }); expect((await request({ action: "remove", memberId })).status).toBe(401); expect(mocks.remove).not.toHaveBeenCalled(); });
it("rejects non-managers before reading or changing the roster", async () => { mocks.rpc.mockResolvedValue({ data: false, error: null }); expect((await request({ action: "member", memberId, roles: ["captain"] })).status).toBe(403); expect(mocks.from).not.toHaveBeenCalled(); });
it("permits the owner to grant manager access", async () => { expect((await request({ action: "member", memberId, roles: ["manager"] })).status).toBe(200); expect(mocks.update).toHaveBeenCalledWith({ roles: ["manager"] }); });
it("prevents a manager from granting manager access", async () => { mocks.getUser.mockResolvedValue({ data: { user: { id: "66666666-6666-4666-8666-666666666666" } } }); expect((await request({ action: "member", memberId, roles: ["manager"] })).status).toBe(403); expect(mocks.update).not.toHaveBeenCalled(); });
it("prevents a manager from removing manager access", async () => { mocks.member.roles = ["manager"]; mocks.getUser.mockResolvedValue({ data: { user: { id: "66666666-6666-4666-8666-666666666666" } } }); expect((await request({ action: "member", memberId, roles: [] })).status).toBe(403); });
it("keeps ownership transfer restricted to the owner and actual team member", async () => { expect((await request({ action: "transfer-owner", memberId, userId: "spoof" })).status).toBe(200); expect(mocks.rpc).toHaveBeenCalledWith("transfer_group_ownership", { p_group_id: id, p_new_owner_id: mocks.member.user_id }); });
it("cannot transfer ownership to a guest placeholder", async () => { mocks.member.user_id = null; expect((await request({ action: "transfer-owner", memberId })).status).toBe(403); });
it("does not remove the owner", async () => { mocks.member.user_id = mocks.group.owner_id; expect((await request({ action: "remove", memberId })).status).toBe(403); expect(mocks.remove).not.toHaveBeenCalled(); });
it("validates role inputs before database writes", async () => { expect((await request({ action: "member", memberId, roles: ["owner"] })).status).toBe(400); expect(mocks.update).not.toHaveBeenCalled(); });

const membershipRequest = (body: unknown) => DELETE(new Request("https://example.com", { method: "DELETE", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
it("requires sign-in for team lifecycle actions", async () => { mocks.getUser.mockResolvedValue({ data: { user: null } }); expect((await membershipRequest({ action: "delete-team" })).status).toBe(401); expect(mocks.remove).not.toHaveBeenCalled(); });
it("preserves the owner's existing ability to delete the team", async () => { expect((await membershipRequest({ action: "delete-team" })).status).toBe(200); expect(mocks.remove).toHaveBeenCalledTimes(1); });
it("denies deleting a team as a non-owner", async () => { mocks.getUser.mockResolvedValue({ data: { user: { id: mocks.member.user_id } } }); expect((await membershipRequest({ action: "delete-team" })).status).toBe(403); expect(mocks.remove).not.toHaveBeenCalled(); });
it("requires owners to transfer ownership before leaving", async () => { expect((await membershipRequest({ action: "leave-team" })).status).toBe(403); expect(mocks.remove).not.toHaveBeenCalled(); });
it("allows a non-owner to leave without requiring manager access", async () => { mocks.getUser.mockResolvedValue({ data: { user: { id: mocks.member.user_id } } }); expect((await membershipRequest({ action: "leave-team", userId: "forged" })).status).toBe(200); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.remove).toHaveBeenCalledTimes(1); });
