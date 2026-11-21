import { describe, expect, it } from "vitest";
import {
  computeCourtFacilityId,
  resolveFacilityByName,
  searchFacilitiesByName,
} from "./facilities";

// These tests assert behavior on the bundled tennis_courts.json dataset.
// The specific facilities used here (Lower Woodland, Amy Yee) have been
// in the catalog since launch — if either is renamed or removed, pick
// another stable venue rather than asserting against a moving target.

describe("computeCourtFacilityId", () => {
  it("returns the explicit id when set, regardless of court text", () => {
    expect(computeCourtFacilityId("totally unmatched", "tf-42")).toBe("tf-42");
  });

  it("returns null for empty / whitespace text without an explicit pick", () => {
    expect(computeCourtFacilityId("", null)).toBeNull();
    expect(computeCourtFacilityId("   ", null)).toBeNull();
  });

  it("returns null when free text matches nothing in the catalog", () => {
    expect(computeCourtFacilityId("Pierre's secret backyard court", null)).toBeNull();
  });

  it("falls back to resolveFacilityByName when free text matches a catalog court", () => {
    // "Lower Woodland" should resolve to the catalog facility of that name.
    const resolved = computeCourtFacilityId("Lower Woodland", null);
    expect(resolved).not.toBeNull();
    // The id format is tf-<externalId>. We don't assert the exact id so
    // the test doesn't break when new venues are inserted ahead of it.
    expect(resolved).toMatch(/^tf-\d+$/);
    // Sanity: same id resolveFacilityByName would have returned.
    expect(resolved).toBe(resolveFacilityByName("Lower Woodland")?.courtId);
  });

  it("explicit pick beats a different resolver match", () => {
    // The composer state can briefly hold an explicit pick whose text was
    // then edited to something else. computeCourtFacilityId must trust
    // the explicit pick rather than re-resolving from the (possibly
    // mismatched) text.
    const lower = resolveFacilityByName("Lower Woodland");
    expect(lower).not.toBeNull();
    expect(lower!.courtId).not.toBe("tf-99999");
    // Override with a different fake id — should be passed through as-is.
    expect(computeCourtFacilityId("Lower Woodland", "tf-99999")).toBe("tf-99999");
  });
});

describe("searchFacilitiesByName", () => {
  it("returns no suggestions for sub-2-character queries", () => {
    expect(searchFacilitiesByName("M", 6)).toEqual([]);
    expect(searchFacilitiesByName(" ", 6)).toEqual([]);
  });

  it("returns up to `limit` matches ordered by score", () => {
    const hits = searchFacilitiesByName("park", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(5);
  });

  it("surfaces a known venue for a short prefix match", () => {
    const hits = searchFacilitiesByName("amy y", 6);
    expect(hits.some((f) => f.name.toLowerCase().includes("amy yee"))).toBe(true);
  });
});

// The token-overlap tier exists for team_matches.location values imported
// from USTA/tennisrecord, whose venue spellings are reordered or variant
// relative to the catalog ("Tukwila Sports Center - Gorin" vs catalog
// "Gorin Sports Tukwila"). These are real strings from the production
// schedule — keep them verbatim.
describe("resolveFacilityByName token-overlap tier", () => {
  it("matches reordered venue names", () => {
    expect(resolveFacilityByName("Tukwila Sports Center - Gorin")?.name).toBe(
      "Gorin Sports Tukwila"
    );
    expect(resolveFacilityByName("Bellevue Tennis Academy-Gorin")?.name).toBe(
      "Gorin Sports Bellevue"
    );
  });

  it("matches near-synonym club names", () => {
    expect(resolveFacilityByName("Forest Crest Athletic Club")?.name).toBe(
      "Forest Crest Tennis Club"
    );
    expect(resolveFacilityByName("Boeing Tennis Club")?.name).toBe(
      "Boeing Employees Tennis Club"
    );
  });

  it("punctuation variants hit the exact tier after normalization", () => {
    expect(resolveFacilityByName("Columbia Athletic Club - Silver Lake")?.name).toBe(
      "Columbia Athletic Club (Silver lake)"
    );
  });

  it("resolves the Harbor Square league venue", () => {
    const f = resolveFacilityByName("Harbor Square Athletic Club");
    expect(f?.name).toBe("Harbor Square Athletic Club");
    expect(f?.address).toContain("Edmonds");
  });

  it("does not cross-match on a single shared word", () => {
    // "club" + nothing else meaningful must not resolve.
    expect(resolveFacilityByName("Chess Club Downtown")).toBeNull();
  });
});
