import { describe, expect, it } from "vitest";
import { categorizePosts } from "./postCategorize";

describe("categorizePosts", () => {
  it("puts find_players posts in findPlayers regardless of attached media", () => {
    const result = categorizePosts([
      { id: "a", postType: "find_players", media: [] },
      { id: "b", postType: "find_players", media: [{ kind: "image" }] },
      { id: "c", postType: "propose_team", media: [] },
    ]);
    expect(result.findPlayers.map((p) => p.id).sort()).toEqual(["a", "b", "c"]);
    expect(result.media).toEqual([]);
  });

  it("routes regular posts with any media into the media bucket", () => {
    const result = categorizePosts([
      { id: "a", postType: "regular", media: [{ kind: "image" }] },
      { id: "b", postType: "regular", media: [{ kind: "video" }] },
      { id: "c", postType: "regular", media: [{ kind: "image" }, { kind: "video" }] },
    ]);
    expect(result.media.map((p) => p.id).sort()).toEqual(["a", "b", "c"]);
    expect(result.findPlayers).toEqual([]);
  });

  it("text-only regular posts land in findPlayers (intentional — see comment)", () => {
    const result = categorizePosts([
      { id: "a", postType: "regular", media: [] },
    ]);
    expect(result.findPlayers.map((p) => p.id)).toEqual(["a"]);
    expect(result.media).toEqual([]);
  });
});
