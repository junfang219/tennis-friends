import { describe, expect, it } from "vitest";
import { parseRegistrationPlayers, registrationDraftSchema, registrationMessage, prepareRegistrationPlayer, registrationChannels, blankRegistrationDraft, invitationIssues, associateRegistrationAccount, acceptRegistrationInvitation } from "./registrationOnboarding";

describe("registration onboarding", () => {
  it("normalizes phone numbers and rejects duplicate recipients", () => {
    expect(parseRegistrationPlayers("Sam Lee, (206) 555-0101")[0].phone).toBe("+12065550101");
    expect(() => parseRegistrationPlayers("Sam, 2065550101\nTaylor, +12065550101")).toThrow("already listed");
    expect(() => parseRegistrationPlayers("Sam, nonsense")).toThrow("Line 1");
  });
  it("allows incomplete drafts and validates USTA details only when enabled", () => {
    expect(registrationDraftSchema.safeParse({ name: "My team", teamNumber: "", deadline: "", players: [] }).success).toBe(true);
    expect(invitationIssues({ ...blankRegistrationDraft(), name: "My team", includeUsta: true, teamNumber: "123" })).toContain("Enter a 10-digit USTA team number.");
  });
  it("includes registration instructions without asking players to self-report", () => {
    const message = registrationMessage({ name: "My team", teamNumber: "1234567890", deadline: "2026-12-04", players: [] }, "http://localhost/team");
    expect(message).toContain("December 4, 2026");
    expect(message).toContain("1234567890");
    expect(message).toContain("tennislink.usta.com");
  });
});

it("supports email-only players and routes existing members through in-app and email", () => {
  const player = prepareRegistrationPlayer({ id: "one", name: "Sam", phone: "", email: "SAM@example.com" }, []);
  expect(player.email).toBe("sam@example.com");
  expect(registrationChannels(player)).toBe("Email");
  expect(registrationChannels({ ...player, memberId: "member-one" })).toBe("Email + In-app invitation");
  expect(() => prepareRegistrationPlayer({ id: "two", name: "Sam", phone: "", email: "sam@example.com" }, [player])).toThrow("already");
  expect(prepareRegistrationPlayer({ id: "three", name: "Sam", phone: "", email: "" }, [])).toMatchObject({ name: "Sam", phone: "", email: "" });
});

it("sends app-only invitations without USTA fields and always includes a join link", () => {
  const player = prepareRegistrationPlayer({ id: "one", name: "Sam", phone: "2065550101", email: "" }, []);
  const draft = { ...blankRegistrationDraft(), name: "Weekend Crew", description: "Saturday tennis", players: [player] };
  expect(invitationIssues(draft)).toEqual([]);
  const message = registrationMessage(draft, "http://localhost/join");
  expect(message).toContain("Join the team: http://localhost/join");
  expect(message).toContain("Saturday tennis");
  expect(message).not.toContain("USTA");
  expect(registrationMessage({ ...draft, includeDescription: false }, "http://localhost/join")).toContain("Saturday tennis");
});
it("supports USTA tasks added later and captain-selected registration links", () => {
  const player = prepareRegistrationPlayer({ id: "one", name: "Sam", phone: "2065550101", email: "" }, []);
  const draft = { ...blankRegistrationDraft(), name: "Weekend Crew", players: [player], includeUsta: true, ustaTeamName: "Official Team", teamNumber: "1234567890", deadline: "2026-12-04", invitationMessage: "See you soon!", includeRegistrationLink: false };
  expect(invitationIssues(draft)).toEqual([]);
  const message = registrationMessage(draft, "http://localhost/join");
  expect(message).toContain("Official Team");
  expect(message).toContain("See you soon!");
  expect(message).not.toContain("tennislink.usta.com");
  expect(message).toContain("Join the team:");
  expect(invitationIssues({ ...draft, deadline: "" })).toContain("Choose a USTA registration deadline.");
});

describe("invitation account linking", () => {
  const invited = () => ({ ...prepareRegistrationPlayer({ id: "roster-one", name: "Sam", phone: "2065550101", email: "" }, []), invitedAt: "2026-11-15T00:00:00Z", confirmedAt: "2026-11-14T00:00:00Z" });
  it("associates a friend without accepting membership", () => {
    const player = associateRegistrationAccount([invited()], "roster-one", { id: "friend", name: "Sam" })[0];
    expect(player.memberId).toBeNull();
    expect(player.associatedAccountId).toBe("friend");
    expect(registrationChannels(player)).toBe("In-app invitation");
  });
  it("links new or existing accounts into the original roster entry and is idempotent", () => {
    for (const id of ["new-account", "existing-account"]) {
      const account = { id, name: "Sam" };
      const players = acceptRegistrationInvitation([invited()], "roster-one", account, "2026-11-15T00:00:00Z");
      expect(players).toHaveLength(1);
      expect(players[0].id).toBe("roster-one");
      expect(players[0].confirmedAt).toBe(invited().confirmedAt);
      expect(players[0].memberId).toBe(id);
      expect(acceptRegistrationInvitation(players, "roster-one", account, "2026-11-16T00:00:00Z")).toEqual(players);
    }
  });
  it("does not require USTA registration to join", () => {
    const player = { ...invited(), confirmedAt: null };
    expect(acceptRegistrationInvitation([player], player.id, { id: "account", name: "Sam" }, "2026-11-15T00:00:00Z")[0].confirmedAt).toBeNull();
  });
  it("requires sign-in and rejects the wrong associated account or duplicate account associations", () => {
    const player = invited();
    expect(() => acceptRegistrationInvitation([player], player.id, null, "now")).toThrow("Sign in");
    const players = associateRegistrationAccount([player], player.id, { id: "friend", name: "Sam" });
    expect(() => acceptRegistrationInvitation(players, player.id, { id: "other", name: "Sam" }, "now")).toThrow("Sign in with");
    const other = { ...invited(), id: "roster-two", phone: "+12065550102" };
    expect(() => associateRegistrationAccount([...players, other], other.id, { id: "friend", name: "Sam" })).toThrow("already associated");
    expect(() => acceptRegistrationInvitation([{ ...player, invitedAt: null }], player.id, { id: "friend", name: "Sam" }, "now")).toThrow("Send this player");
  });
});

it("accepts an unassociated invitation using an email or social account without a phone", () => {
  const player = { ...prepareRegistrationPlayer({ id: "email-player", name: "Taylor", phone: "", email: "taylor@example.com" }, []), invitedAt: "2026-11-15T00:00:00Z" };
  const result = acceptRegistrationInvitation([player], player.id, { id: "apple-account", name: "Taylor Chen" }, "2026-11-15T01:00:00Z");
  expect(result[0].memberId).toBe("apple-account");
  expect(result[0].id).toBe(player.id);
});
