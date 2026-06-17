import { describe, expect, it } from "vitest";
import { buildSeededAvailabilityRows } from "./availabilityPolls";

describe("buildSeededAvailabilityRows", () => {
  it("marks window members 'playing' and the rest 'not_playing', match_types blank", () => {
    const rows = buildSeededAvailabilityRows("m1", {
      playing: [
        { memberId: "ma", userId: "a" },
        { memberId: "mb", userId: "b" },
      ],
      notPlaying: [{ memberId: "mc", userId: "c" }],
    });
    expect(rows).toEqual([
      { event_kind: "match", match_id: "m1", member_id: "ma", user_id: "a", status: "playing", match_types: "" },
      { event_kind: "match", match_id: "m1", member_id: "mb", user_id: "b", status: "playing", match_types: "" },
      { event_kind: "match", match_id: "m1", member_id: "mc", user_id: "c", status: "not_playing", match_types: "" },
    ]);
  });

  it("returns an empty array when both groups are empty", () => {
    expect(buildSeededAvailabilityRows("m1", { playing: [], notPlaying: [] })).toEqual([]);
  });
});
