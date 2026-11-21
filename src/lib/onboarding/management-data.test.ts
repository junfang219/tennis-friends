import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
const mocks = vi.hoisted(() => ({ roster: vi.fn(), rpc: vi.fn(), legacy: vi.fn() }));
vi.mock("./roster-data", () => ({ readTeamRoster: mocks.roster }));
vi.mock("./delivery-config", () => ({ smsReadiness: () => ({ configured: true, publicOrigin: true }) }));
// The read path must not import delivery SDKs just to calculate readiness.
vi.mock("twilio", () => { throw new Error("Twilio SDK loaded during a read"); });
vi.mock("resend", () => { throw new Error("Email SDK loaded during a read"); });
import { readTeamManagement } from "./management-data";
const id = "33333333-3333-4333-8333-333333333333";
const group = { id, name: "Current team name", ownerId: "11111111-1111-4111-8111-111111111111", members: [], memberTypes: [] };
const query = { select: () => query, eq: () => query, gt: mocks.legacy };
const db = { rpc: mocks.rpc, from: () => query } as unknown as SupabaseClient<Database>;
beforeEach(() => {
  vi.clearAllMocks(); mocks.roster.mockResolvedValue(group);
  mocks.rpc.mockResolvedValue({ data: { config: null, players: [] }, error: null });
  mocks.legacy.mockResolvedValue({ data: [], error: null });
});
it("reads invitations and legacy links while the shared roster lookup is still pending", async () => {
  let finishRoster!: (value: typeof group) => void;
  const roster = new Promise<typeof group>(resolve => { finishRoster = resolve; });
  const loading = readTeamManagement(db, id, roster);
  await Promise.resolve();
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("read_team_onboarding", { p_group: id });
  expect(mocks.legacy).toHaveBeenCalledTimes(1); expect(mocks.roster).not.toHaveBeenCalled();
  finishRoster(group);
  expect(await loading).toMatchObject({ config: { name: group.name, includeUsta: false }, players: [], delivery: { sms: { configured: true, publicOrigin: true } } });
});
it("loads an older team's defaults without writing or initializing records", async () => {
  await readTeamManagement(db, id);
  expect(mocks.roster).toHaveBeenCalledExactlyOnceWith(db, id);
  expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(["read_team_onboarding"]);
});
it("rejects lost manager access even when roster data was already available", async () => {
  mocks.rpc.mockResolvedValue({ error: { code: "42501" } });
  await expect(readTeamManagement(db, id, Promise.resolve(group))).rejects.toMatchObject({ status: 403 });
});
it.each([null, { config: "bad", players: [] }, { config: {}, players: [{}] }])("rejects malformed stored state %j", async data => {
  mocks.rpc.mockResolvedValue({ data, error: null });
  await expect(readTeamManagement(db, id)).rejects.toMatchObject({ status: 500 });
});
it("does not silently hide failed legacy invitation reads", async () => {
  mocks.legacy.mockResolvedValue({ data: null, error: { code: "failed" } });
  await expect(readTeamManagement(db, id)).rejects.toMatchObject({ status: 500 });
});
