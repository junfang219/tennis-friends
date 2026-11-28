import { describe, expect, it } from "vitest";
import { teamLanding, type LandingMatch } from "./teamLanding";

const owner = { id: "owner-row", user_id: "owner", roles: [], placeholder_scope: null };
const player = { id: "player-row", user_id: "player", roles: [], placeholder_scope: null };
const guest = { id: "guest-row", user_id: null, roles: [], placeholder_scope: "practice" };
const group = {
  groupId: "team", ownerId: owner.user_id, now: new Date("2026-11-26T20:00:00Z"),
  onboardingEnabled: true,
};
const match: LandingMatch = {
  id: "next", match_date: "2026-11-28", match_time: "10:00", timezone: "America/Los_Angeles",
  location: "Green Lake", opponent: "Rally Club", scheduling_status: "fixed", window_end: null,
  availabilities: [], format: [{ code: "D1", type: "doubles" }],
};

describe("team landing", () => {
  it("moves roster admins from inviting to managing after someone joins", () => {
    const withoutPlayers = teamLanding({ ...group, userId: "owner", members: [owner, guest], matches: [] });
    expect(withoutPlayers?.action).toEqual({ label: "Invite players", href: "/groups/team/invite-players" });
    const withPlayers = teamLanding({ ...group, userId: "owner", members: [owner, player], matches: [] });
    expect(withPlayers?.action).toEqual({ label: "Manage roster", href: "/groups/team/roster" });
  });

  it("prioritizes invitations on an imported schedule until someone joins", () => {
    const base = { ...group, userId: "owner", matches: [match] };
    expect(teamLanding({ ...base, members: [owner, guest] })?.action?.label).toBe("Invite players");
    expect(teamLanding({ ...base, members: [owner, player] })?.action?.label).toBe("Review availability");
  });

  it("uses the earliest unanswered upcoming match for a member", () => {
    const answered = { ...match, availabilities: [{ member_id: player.id, status: "not_available", lineup_slot: "" }] };
    const past = { ...match, id: "past", match_date: "2026-11-26", match_time: "10:00" };
    const later = { ...match, id: "later", match_date: "2026-12-05" };
    expect(teamLanding({
      ...group, userId: "player", members: [owner, player], matches: [later, past, answered],
    })).toMatchObject({
      role: "Member", context: "Upcoming match",
      action: { label: "Set my availability", href: "/groups/team/availability?focus=later&respond=1" },
    });
  });

  it("keeps an open scheduling window and a saved legacy response visible", () => {
    const window: LandingMatch = {
      ...match, match_date: "2026-11-23", match_time: "", scheduling_status: "window",
      availabilities: [{ member_id: player.id, status: "available", lineup_slot: "" }],
    };
    expect(teamLanding({ ...group, userId: "player", members: [owner, player], matches: [window] }))
      .toMatchObject({
        details: "Mon, Nov 23 to Sun, Nov 29 · Green Lake",
        status: "Availability up to date · Your response: Playing",
        action: { label: "Edit response", href: "/groups/team/availability?focus=next&respond=1", secondary: true },
      });
  });

  it("shows the scheduled local time and stops prompting after a match on the spring transition", () => {
    const transitionMatch = { ...match, match_date: "2027-03-14", match_time: "08:30" };
    const input = { ...group, userId: "player", members: [owner, player], matches: [transitionMatch] };
    expect(teamLanding({ ...input, now: new Date("2027-03-14T15:00:00Z") })).toMatchObject({
      details: "Sun, Mar 14, 8:30 AM · Green Lake",
      action: { label: "Set my availability" },
    });
    expect(teamLanding({ ...input, now: new Date("2027-03-14T16:00:00Z") })).toEqual({
      role: "Member", title: "No upcoming matches",
    });
  });

  it.each([
    { other: null, label: "Review availability", status: "1 of 2 players responded" },
    { other: "maybe", label: "Review availability", status: "All 2 responded · 1 available · 1 more needed for the lineup" },
    { other: "playing", label: "Set lineup", status: "All 2 responded · 2 available" },
  ])("uses eligible match players to pick $label with reply $other", ({ other, label, status }) => {
    const playing = { member_id: owner.id, status: "playing", lineup_slot: "" };
    const availabilities = other ? [playing, { ...playing, member_id: player.id, status: other }] : [playing];
    expect(teamLanding({
      ...group, userId: "owner", members: [owner, player, guest], matches: [{ ...match, availabilities }],
    })).toMatchObject({ status, action: { label, href: "/groups/team/availability?focus=next" } });
  });

  it("offers View lineup for a filled format and skips roster administration for match-only captains", () => {
    const captain = { ...player, roles: ["captain" as const] };
    const availabilities = [owner, player].map(member => ({ member_id: member.id, status: "playing", lineup_slot: "D1" }));
    const base = { ...group, userId: "player", members: [owner, captain] };
    expect(teamLanding({ ...base, matches: [{ ...match, availabilities }] })?.action?.label).toBe("View lineup");
    expect(teamLanding({ ...base, matches: [] })?.action).toBeUndefined();
  });

  it("does not expose team guidance to someone outside the active roster", () => {
    expect(teamLanding({ ...group, userId: "other", members: [owner, player], matches: [match] })).toBeNull();
  });
});
