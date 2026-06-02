// Shared post-tab categorization for the profile pages (/profile and
// /profile/[id]). Two buckets: Find Players (game posts + text-only) and
// Media (anything with at least one photo or video attached). Mixed
// photo+video posts go into Media; the grid cell renders the first item.

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

export function hasMedia(p: CategorizablePost): boolean {
  return (p.media ?? []).length > 0;
}

export interface ProfileTabBuckets<P> {
  findPlayers: P[];
  media: P[];
}

// Find Players: every game post (regardless of media) PLUS plain text
// posts. Media: visual-only — game posts never bleed in even when they
// carry attachments.
export function categorizePosts<P extends CategorizablePost>(
  posts: P[]
): ProfileTabBuckets<P> {
  return {
    findPlayers: posts.filter((p) => isGamePost(p) || !hasMedia(p)),
    media: posts.filter((p) => hasMedia(p) && !isGamePost(p)),
  };
}
