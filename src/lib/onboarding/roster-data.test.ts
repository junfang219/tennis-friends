import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { readTeamRoster } from "./roster-data";
const id = "33333333-3333-4333-8333-333333333333", memberId = "44444444-4444-4444-8444-444444444444", userId = "55555555-5555-4555-8555-555555555555";
function client(members: unknown[], group: unknown = { id, name: "Team", owner_id: userId, member_types: ["Sub"] }) {
  const from = vi.fn((table: string) => {
    const q = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), order: vi.fn(), maybeSingle: vi.fn() };
    q.select.mockReturnValue(q); q.eq.mockReturnValue(q);
    q.is.mockReturnValue(q);
    q.order.mockReturnValueOnce(q).mockResolvedValue({ data: members, error: null });
    q.maybeSingle.mockResolvedValue({ data: group, error: null });
    if (table !== "groups" && table !== "group_members") throw new Error("Unexpected table");
    return q;
  });
  return { db: { from } as unknown as SupabaseClient<Database>, from };
}
describe("server roster loader", () => {
  it("reads normalized memberships directly through the supplied server client", async () => {
    const { db, from } = client([{ id: memberId, user_id: userId, roles: ["manager"], member_type: "Sub", placeholder_name: null, user: { id: userId, name: "Taylor", profile_image_url: null } }]);
    const result = await readTeamRoster(db, id);
    expect(result).toMatchObject({ name: "Team", ownerId: userId, members: [{ userId, roles: ["manager"], user: { name: "Taylor", profileImageUrl: "" } }] });
    expect(from.mock.calls.map(c => c[0])).toEqual(["groups", "group_members"]);
    expect(from.mock.results[1].value?.order.mock.calls).toEqual([
      ["created_at", { ascending: true }],
      ["id", { ascending: true }],
    ]);
  });
  it("supports guest placeholders without returning personal contacts or claim credentials", async () => {
    const { db } = client([{ id: memberId, user_id: null, roles: [], member_type: "Guest", placeholder_name: "Guest player", user: null, placeholder_phone: "sensitive", claim_token: "sensitive" }]);
    const result = await readTeamRoster(db, id);
    expect(result?.members[0]).toMatchObject({ userId: null, isPlaceholder: true, user: { id: "", name: "Guest player" } });
    expect(JSON.stringify(result)).not.toContain("sensitive");
  });
  it("normalizes joined profile arrays and filters unknown roles", async () => {
    const { db } = client([{ id: memberId, user_id: userId, roles: ["captain", "owner"], member_type: "", placeholder_name: null, user: [{ id: userId, name: "Taylor", profile_image_url: "" }] }]);
    expect((await readTeamRoster(db, id))?.members[0].roles).toEqual(["captain"]);
  });
  it("reports missing groups without synthesizing a roster", async () => { const { db } = client([], null); expect(await readTeamRoster(db, id)).toBeNull(); });
});
