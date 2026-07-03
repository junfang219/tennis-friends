import { describe, it, expect } from "vitest";
import { buildRsvpRequestText, availabilityLink } from "./rsvpRequest";

describe("buildRsvpRequestText", () => {
  it("lists each selected match with date, opponent, and location", () => {
    const text = buildRsvpRequestText("Slice Girls", [
      {
        matchDate: "2026-07-05",
        matchTime: "6:00 PM",
        opponent: "Aces",
        location: "Central Park",
      },
    ]);
    expect(text).toContain("🎾 Slice Girls — please set your availability:");
    expect(text).toContain("vs Aces");
    expect(text).toContain("Central Park");
    expect(text).toContain("6:00 PM");
    expect(text.trimEnd().endsWith("Tap to RSVP:")).toBe(true);
  });

  it("omits missing opponent/location/time bits", () => {
    const text = buildRsvpRequestText("Team", [{ matchDate: "2026-07-05" }]);
    expect(text).not.toContain("vs ");
    expect(text).not.toContain(" · ·");
    expect(text).toContain(" • "); // still has the bullet + date
  });

  it("handles multiple matches (one line each)", () => {
    const text = buildRsvpRequestText("Team", [
      { matchDate: "2026-07-05", opponent: "Aces" },
      { matchDate: "2026-07-13", opponent: "Smashers" },
    ]);
    expect(text.match(/ • /g)?.length).toBe(2);
  });

  it("still produces a usable message with no matches", () => {
    const text = buildRsvpRequestText("Team", []);
    expect(text).toContain("please set your availability");
    expect(text).toContain("Tap to RSVP:");
    expect(text).not.toContain(" • ");
  });
});

describe("availabilityLink", () => {
  const origin = "https://app.test";
  const gid = "g1";

  it("focuses the single selected match", () => {
    expect(availabilityLink(origin, gid, ["m1"])).toBe(
      "https://app.test/groups/g1/availability?focus=m1",
    );
  });

  it("drops focus when 0 or many matches are selected", () => {
    const base = "https://app.test/groups/g1/availability";
    expect(availabilityLink(origin, gid, [])).toBe(base);
    expect(availabilityLink(origin, gid, ["m1", "m2"])).toBe(base);
  });
});
