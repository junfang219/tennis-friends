import { afterEach, describe, expect, it, vi } from "vitest";
import { notificationTarget, universalLinkTarget } from "./nativeNavigation";
import { readLastTeam, rememberLastTeam, teamLaunchTarget } from "./teamNavigation";

const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";

describe("team launch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps Feed for zero active teams and opens the single active team", () => {
    expect(teamLaunchTarget([], first)).toBeNull();
    expect(teamLaunchTarget([{ id: second }], first)).toBe(`/groups/${second}`);
  });

  it("only reopens a saved team that remains an active membership", () => {
    const teams = [{ id: first }, { id: second }];
    expect(teamLaunchTarget(teams, null)).toBe("/groups");
    expect(teamLaunchTarget(teams, "archived-or-removed")).toBe("/groups");
    expect(teamLaunchTarget(teams, second)).toBe(`/groups/${second}`);
  });

  it("keeps last-team preferences separate across accounts and tolerates disabled storage", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    } });
    rememberLastTeam(first, second);
    expect(readLastTeam(first)).toBe(second);
    expect(readLastTeam(second)).toBeNull();
    vi.stubGlobal("window", {});
    expect(() => rememberLastTeam(first, second)).not.toThrow();
    expect(readLastTeam(first)).toBeNull();
  });
});

describe("native navigation targets", () => {
  it("keeps the invitation path and preserves post query and fragment targets", () => {
    expect(universalLinkTarget("https://mytennisfriends.com/join-team/sample")).toBe("/join-team/sample");
    expect(universalLinkTarget(`https://mytennisfriends.com/?post=${first}#discussion`)).toBe(`/?post=${first}#discussion`);
    expect(universalLinkTarget("https://mytennisfriends.com//example.org")).toBeNull();
    expect(universalLinkTarget("https://mytennisfriends.com.example.org/join-team/sample")).toBeNull();
  });

  it("opens the specific match, practice, or poll from a notification", () => {
    expect(notificationTarget({ kind: "match", teamId: first, refId: second })).toBe(`/groups/${first}/availability?focus=${second}`);
    expect(notificationTarget({ kind: "practice", teamId: first, refId: second })).toBe(`/groups/${first}/practice?focus=${second}`);
    expect(notificationTarget({ kind: "availability_poll", groupId: first, pollId: second })).toBe(`/groups/${first}/availability/polls/${second}`);
    expect(notificationTarget({ kind: "match", teamId: "../example", refId: second })).toBeNull();
  });
});
