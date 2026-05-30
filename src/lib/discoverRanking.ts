import { distanceMeters } from "./haversine";

const METERS_PER_MILE = 1609.344;

export type DiscoverSort = "distance" | "recent";

// The fields the Discover Players ranking needs off each candidate profile.
// Kept minimal so any row shape carrying these can be ranked.
export interface RankablePlayer {
  name: string;
  handle: string | null;
  customTags: string[];
  latitude: number | null;
  longitude: number | null;
  // Presence heartbeat — drives "recent". Falls back to updatedAt when absent
  // (e.g. older rows before last_active existed).
  lastActive: string | null;
  updatedAt: string;
}

export interface RankOptions {
  // Viewer's coordinates, or null when they haven't shared a location — in
  // which case no distances are computed and "distance" sort is a no-op.
  viewer: { lat: number; lng: number } | null;
  sort: DiscoverSort;
  // Free-text match against name + @handle (case-insensitive, leading @ ok).
  query?: string;
  // Substring match against any of the player's custom tags.
  tag?: string;
}

/**
 * Ranks Discover Players candidates for display: annotates each with its
 * distance from the viewer (miles, or null when either side lacks coords),
 * applies the text + tag filters, then sorts.
 *
 *  - "distance": closest first; rows with no computable distance sink last.
 *  - "recent":   most recently active first (last_active, falling back to
 *                updatedAt for rows without a heartbeat yet).
 */
export function rankPlayers<T extends RankablePlayer>(
  players: T[],
  opts: RankOptions
): (T & { distanceMiles: number | null })[] {
  const q = (opts.query ?? "").trim().toLowerCase().replace(/^@/, "");
  const tag = (opts.tag ?? "").trim().toLowerCase();

  const withDistance = players.map((u) => ({
    ...u,
    distanceMiles:
      opts.viewer && u.latitude != null && u.longitude != null
        ? distanceMeters(opts.viewer.lat, opts.viewer.lng, u.latitude, u.longitude) /
          METERS_PER_MILE
        : null,
  }));

  const filtered = withDistance.filter((u) => {
    if (q) {
      const hay = `${u.name} ${u.handle ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (tag && !u.customTags.some((t) => t.toLowerCase().includes(tag))) return false;
    return true;
  });

  return filtered.sort((a, b) => {
    if (opts.sort === "distance") {
      if (a.distanceMiles == null) return b.distanceMiles == null ? 0 : 1;
      if (b.distanceMiles == null) return -1;
      return a.distanceMiles - b.distanceMiles;
    }
    const aRecent = a.lastActive ?? a.updatedAt;
    const bRecent = b.lastActive ?? b.updatedAt;
    return bRecent.localeCompare(aRecent);
  });
}
