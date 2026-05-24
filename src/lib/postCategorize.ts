// Shared post-tab categorization for the profile pages (/profile and
// /profile/[id]). Find Players / Photos / Videos use the same buckets,
// so keep the rules in one place.
//
// History note: an earlier version of this filter lived inline on both
// pages and only checked `mediaType === "image"`. That broke once
// multi-photo posts started storing their URLs in `photoUrls` (with the
// `media_*` columns left empty) — those posts fell through into the
// Find Players tab as if they were text-only.

export interface CategorizablePost {
  postType?: string;
  mediaType?: string;
  mediaUrl?: string;
  photoUrls?: string[];
}

export function isGamePost(p: CategorizablePost): boolean {
  return p.postType === "find_players" || p.postType === "propose_team";
}

// True for both multi-photo posts (URLs in photoUrls, empty media_*) and
// legacy single-photo posts (mediaType="image", URL in mediaUrl).
export function hasPhotos(p: CategorizablePost): boolean {
  return (p.photoUrls?.length ?? 0) > 0 || p.mediaType === "image";
}

export function hasVideo(p: CategorizablePost): boolean {
  return p.mediaType === "video";
}

export interface ProfileTabBuckets<P> {
  findPlayers: P[];
  photos: P[];
  videos: P[];
}

// Find Players: every game post (regardless of media) PLUS plain text
// posts. Photos / Videos: visual-only — game posts never bleed in even
// when they carry an image.
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
