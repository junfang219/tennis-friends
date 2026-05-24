import { describe, expect, it } from "vitest";
import { categorizePosts } from "./postCategorize";

describe("categorizePosts", () => {
  it("puts find_players posts in findPlayers regardless of attached media", () => {
    const result = categorizePosts([
      { id: "a", postType: "find_players", mediaType: "", photoUrls: [] },
      { id: "b", postType: "find_players", mediaType: "", photoUrls: ["x.jpg"] },
      { id: "c", postType: "propose_team", mediaType: "", photoUrls: [] },
    ]);
    expect(result.findPlayers.map((p) => p.id).sort()).toEqual(["a", "b", "c"]);
    expect(result.photos).toEqual([]);
    expect(result.videos).toEqual([]);
  });

  // Regression: multi-photo regular posts (PostComposer stores URLs in
  // photoUrls and leaves media_type empty) used to fall into Find Players
  // because the filter only checked mediaType === "image".
  it("routes multi-photo regular posts to photos, not findPlayers", () => {
    const result = categorizePosts([
      { id: "a", postType: "regular", mediaType: "", photoUrls: ["one.jpg"] },
      { id: "b", postType: "regular", mediaType: "", photoUrls: ["one.jpg", "two.jpg"] },
    ]);
    expect(result.photos.map((p) => p.id).sort()).toEqual(["a", "b"]);
    expect(result.findPlayers).toEqual([]);
  });

  it("still routes legacy single-photo posts (mediaType=image) to photos", () => {
    const result = categorizePosts([
      { id: "a", postType: "regular", mediaType: "image", mediaUrl: "x.jpg", photoUrls: [] },
    ]);
    expect(result.photos.map((p) => p.id)).toEqual(["a"]);
    expect(result.findPlayers).toEqual([]);
  });

  it("routes regular video posts to videos", () => {
    const result = categorizePosts([
      { id: "a", postType: "regular", mediaType: "video", mediaUrl: "x.mp4", photoUrls: [] },
    ]);
    expect(result.videos.map((p) => p.id)).toEqual(["a"]);
    expect(result.findPlayers).toEqual([]);
    expect(result.photos).toEqual([]);
  });

  it("text-only regular posts land in findPlayers (intentional — see comment)", () => {
    const result = categorizePosts([
      { id: "a", postType: "regular", mediaType: "", photoUrls: [] },
    ]);
    expect(result.findPlayers.map((p) => p.id)).toEqual(["a"]);
  });
});
