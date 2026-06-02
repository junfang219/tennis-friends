// Shared post-tab categorization for the profile pages (/profile and
// /profile/[id]). Find Players / Photos / Videos use the same buckets,
// so keep the rules in one place.
//
// Posts now carry a single ordered `media: { kind }[]` list (images and
// videos interleaved) — `hasPhotos`/`hasVideo` scan the list. A mixed
// photo+video post appears in BOTH the Photos and Videos tabs, which is
// the expected behavior: each tab answers "does this post have X?".

export interface CategorizableMediaItem {
  kind: "image" | "video";
}

export interface CategorizablePost {
  postType?: string;
  media?: CategorizableMediaItem[];
}

export function isGamePost(p: CategorizablePost): boolean {
  return p.postType === "find_players" || p.postType === "propose_team";
}

export function hasPhotos(p: CategorizablePost): boolean {
  return (p.media ?? []).some((m) => m.kind === "image");
}

export function hasVideo(p: CategorizablePost): boolean {
  return (p.media ?? []).some((m) => m.kind === "video");
}

export interface ProfileTabBuckets<P> {
  findPlayers: P[];
  photos: P[];
  videos: P[];
}

// Find Players: every game post (regardless of media) PLUS plain text
// posts. Photos / Videos: visual-only — game posts never bleed in even
// when they carry media.
export function categorizePosts<P extends CategorizablePost>(
  posts: P[]
): ProfileTabBuckets<P> {
  return {
    findPlayers: posts.filter(
      (p) => isGamePost(p) || (!hasPhotos(p) && !hasVideo(p))
    ),
    photos: posts.filter((p) => hasPhotos(p) && !isGamePost(p)),
    videos: posts.filter((p) => hasVideo(p) && !isGamePost(p)),
  };
}
