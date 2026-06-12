import { describe, expect, it } from "vitest";
import {
  parseCenterIdFromBookingUrl,
  resolveSeattleVenue,
  getSeattleVenueByCenterId,
  resolveAvailabilityTarget,
} from "./activenetSeattleCourts";

// Real Seattle Parks booking URLs from data/tennis_courts.json.
const AMY_YEE_URL =
  "https://anc.apm.activecommunities.com/seattle/reservation/search?keyword=tennis%20court&resourceType=0&equipmentQty=0&facilityCenterIds=2";

describe("parseCenterIdFromBookingUrl", () => {
  it("pulls the center id out of a facilityCenterIds URL", () => {
    expect(parseCenterIdFromBookingUrl(AMY_YEE_URL)).toBe(2);
  });

  it("returns null for null / missing / param-less URLs", () => {
    expect(parseCenterIdFromBookingUrl(null)).toBeNull();
    expect(parseCenterIdFromBookingUrl(undefined)).toBeNull();
    expect(
      parseCenterIdFromBookingUrl(
        "https://anc.apm.activecommunities.com/seattle/reservation/search?keyword=tennis"
      )
    ).toBeNull();
  });
});

describe("resolveSeattleVenue", () => {
  it("resolves by center id from the booking URL", () => {
    const v = resolveSeattleVenue({ bookingUrl: AMY_YEE_URL, name: "Amy Yee" });
    expect(v?.centerId).toBe(2);
    expect(v?.courts.length).toBeGreaterThan(0);
  });

  it("falls back to a strict name match when the URL has no center id", () => {
    // Volunteer Park's catalog URL omits facilityCenterIds; the name matches
    // seed center 21 once the "Tennis Court" suffix is stripped.
    const v = resolveSeattleVenue({
      bookingUrl:
        "https://anc.apm.activecommunities.com/seattle/reservation/search?keyword=tennis",
      name: "Volunteer Park Tennis Court",
    });
    expect(v?.centerId).toBe(21);
  });

  it("does NOT loosely match ambiguous names (Green Lake East ≠ seed's Green Lake Park)", () => {
    const v = resolveSeattleVenue({
      bookingUrl: null,
      name: "Green Lake Park East Tennis Courts",
    });
    expect(v).toBeNull();
  });

  it("returns null when neither id nor name resolves (e.g. Alki, not in seed)", () => {
    const v = resolveSeattleVenue({
      bookingUrl:
        "https://anc.apm.activecommunities.com/seattle/reservation/search?facilityCenterIds=134",
      name: "Alki Playfield Tennis Courts",
    });
    expect(v).toBeNull();
  });
});

describe("resolveAvailabilityTarget", () => {
  it("splits Lower/Upper Woodland to center 13 with the right court tag", () => {
    expect(resolveAvailabilityTarget({ courtId: "tf-20" })).toEqual({
      centerId: 13,
      courtNameIncludes: "(Lower)",
    });
    expect(resolveAvailabilityTarget({ courtId: "tf-39" })).toEqual({
      centerId: 13,
      courtNameIncludes: "(Upper)",
    });
  });

  it("falls back to the normal resolution (no filter) for a regular venue", () => {
    const t = resolveAvailabilityTarget({ courtId: "tf-2", bookingUrl: AMY_YEE_URL, name: "Amy Yee" });
    expect(t).toEqual({ centerId: 2, courtNameIncludes: null });
  });

  it("returns null for an unresolvable venue", () => {
    expect(resolveAvailabilityTarget({ courtId: "tf-999", bookingUrl: null, name: "Nowhere" })).toBeNull();
  });
});

describe("getSeattleVenueByCenterId", () => {
  it("looks up a known center", () => {
    expect(getSeattleVenueByCenterId(2)?.name).toContain("Amy Yee");
  });

  it("returns null for an unknown center", () => {
    expect(getSeattleVenueByCenterId(999999)).toBeNull();
  });
});
