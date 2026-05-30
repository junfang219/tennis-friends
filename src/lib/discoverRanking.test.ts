import { describe, expect, it } from "vitest";
import { rankPlayers, type RankablePlayer } from "./discoverRanking";

// Reference coordinates around Seattle so distances are realistic.
const SEATTLE = { lat: 47.6062, lng: -122.3321 };

function player(overrides: Partial<RankablePlayer> & { name: string }): RankablePlayer {
  return {
    handle: null,
    customTags: [],
    latitude: null,
    longitude: null,
    lastActive: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("rankPlayers — distance sort", () => {
  const near = player({ name: "Near", latitude: 47.61, longitude: -122.33 }); // ~hundreds of m
  const far = player({ name: "Far", latitude: 47.9, longitude: -122.0 }); // tens of miles
  const noCoords = player({ name: "NoCoords" });

  it("orders closest first and sinks coord-less rows to the bottom", () => {
    const ranked = rankPlayers([far, noCoords, near], { viewer: SEATTLE, sort: "distance" });
    expect(ranked.map((p) => p.name)).toEqual(["Near", "Far", "NoCoords"]);
  });

  it("annotates each row with distance in miles (null when uncomputable)", () => {
    const ranked = rankPlayers([near, noCoords], { viewer: SEATTLE, sort: "distance" });
    const nearOut = ranked.find((p) => p.name === "Near")!;
    expect(nearOut.distanceMiles).toBeGreaterThan(0);
    expect(nearOut.distanceMiles).toBeLessThan(5);
    expect(ranked.find((p) => p.name === "NoCoords")!.distanceMiles).toBeNull();
  });

  it("computes no distances when the viewer has no location", () => {
    const ranked = rankPlayers([near, far], { viewer: null, sort: "distance" });
    expect(ranked.every((p) => p.distanceMiles === null)).toBe(true);
  });
});

describe("rankPlayers — recent sort", () => {
  it("orders most recently active first (by lastActive)", () => {
    const old = player({ name: "Old", lastActive: "2025-01-01T00:00:00Z" });
    const fresh = player({ name: "Fresh", lastActive: "2026-05-01T00:00:00Z" });
    const mid = player({ name: "Mid", lastActive: "2026-02-01T00:00:00Z" });
    const ranked = rankPlayers([old, fresh, mid], { viewer: null, sort: "recent" });
    expect(ranked.map((p) => p.name)).toEqual(["Fresh", "Mid", "Old"]);
  });

  it("uses lastActive over updatedAt — an actively-present but unedited profile ranks first", () => {
    // Edited long ago but active today.
    const active = player({
      name: "Active",
      updatedAt: "2025-01-01T00:00:00Z",
      lastActive: "2026-05-30T00:00:00Z",
    });
    // Edited profile recently but hasn't opened the app since.
    const edited = player({
      name: "Edited",
      updatedAt: "2026-05-20T00:00:00Z",
      lastActive: "2026-01-15T00:00:00Z",
    });
    const ranked = rankPlayers([edited, active], { viewer: null, sort: "recent" });
    expect(ranked.map((p) => p.name)).toEqual(["Active", "Edited"]);
  });

  it("falls back to updatedAt when lastActive is null", () => {
    const a = player({ name: "A", lastActive: null, updatedAt: "2026-05-01T00:00:00Z" });
    const b = player({ name: "B", lastActive: null, updatedAt: "2026-02-01T00:00:00Z" });
    const ranked = rankPlayers([b, a], { viewer: null, sort: "recent" });
    expect(ranked.map((p) => p.name)).toEqual(["A", "B"]);
  });
});

describe("rankPlayers — filters", () => {
  const alice = player({ name: "Alice Smith", handle: "ace_alice", customTags: ["Seattle", "Doubles"] });
  const bob = player({ name: "Bob Jones", handle: "bobby", customTags: ["Bellevue"] });

  it("matches free text against name and @handle, case-insensitively", () => {
    expect(rankPlayers([alice, bob], { viewer: null, sort: "recent", query: "alice" }).map((p) => p.name)).toEqual([
      "Alice Smith",
    ]);
    // Leading @ and handle match both work.
    expect(rankPlayers([alice, bob], { viewer: null, sort: "recent", query: "@BOBBY" }).map((p) => p.name)).toEqual([
      "Bob Jones",
    ]);
  });

  it("matches tags as a case-insensitive substring", () => {
    expect(rankPlayers([alice, bob], { viewer: null, sort: "recent", tag: "seattle" }).map((p) => p.name)).toEqual([
      "Alice Smith",
    ]);
  });

  it("blank query and tag are no-ops", () => {
    expect(
      rankPlayers([alice, bob], { viewer: null, sort: "recent", query: "  ", tag: "" }).length
    ).toBe(2);
  });
});
