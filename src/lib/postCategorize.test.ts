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
    expect(result.photos).toEqual([]);
    expect(result.videos).toEqual([]);
  });

  it("routes regular photo posts to photos, not findPlayers", () => {
    const result = categorizePosts([
      { id: "a", postType: "regular", media: [{ kind: "image" }] },
      { id: "b", postType: "regular", media: [{ kind: "image" }, { kind: "image" }] },
    ]);
    expect(result.photos.map((p) => p.id).sort()).toEqual(["a", "b"]);
    expect(result.findPlayers).toEqual([]);
  });

  it("routes regular video posts to videos", () => {
    const result = categorizePosts([
      { id: "a", postType: "regular", media: [{ kind: "video" }] },
    ]);
    expect(result.videos.map((p) => p.id)).toEqual(["a"]);
    expect(result.findPlayers).toEqual([]);
    expect(result.photos).toEqual([]);
  });

  // A post with both an image and a video shows up in BOTH the Photos
  // and Videos tabs — each tab answers "does this post have X?".
  it("mixed photo+video posts appear in both photos and videos buckets", () => {
    const result = categorizePosts([
      { id: "a", postType: "regular", media: [{ kind: "image" }, { kind: "video" }] },
    ]);
    expect(result.photos.map((p) => p.id)).toEqual(["a"]);
    expect(result.videos.map((p) => p.id)).toEqual(["a"]);
    expect(result.findPlayers).toEqual([]);
  });

  it("text-only regular posts land in findPlayers (intentional — see comment)", () => {
    const result = categorizePosts([
      { id: "a", postType: "regular", media: [] },
    ]);
    expect(result.findPlayers.map((p) => p.id)).toEqual(["a"]);
  });
});
