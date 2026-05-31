// Build & dispatch a native share for "Looking for Players" posts.
// Used by SendToModal in PostCard to surface the OS share sheet on
// supported browsers, with a clipboard fallback elsewhere.

export type LfpSharePost = {
  id: string;
  postType?: string;
  playDate?: string;        // "2026-06-15"
  playTime?: string;        // "14:00"
  playDuration?: number;    // minutes
  courtLocation?: string;
  gameType?: string;        // "singles" | "doubles" | "mixed doubles" | "practice"
  playersNeeded?: number;
  skillMin?: number | null;
  skillMax?: number | null;
  authorName?: string;
};

export type LfpSharePayload = { title: string; text: string; url: string };

function formatPlayDate(playDate: string): string {
  // Anchor to noon to dodge the UTC-midnight day-shift on negative offsets.
  const d = new Date(`${playDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return playDate;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatPlayTime(t: string): string {
  const [hhStr, mmStr] = t.split(":");
  const hh = Number(hhStr);
  const mm = Number(mmStr);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return t;
  const period = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 || 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${period}`;
}

function formatGameType(gameType: string): string {
  // Title-case the snake-case-ish enum value.
  return gameType
    .split(/[\s_]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function formatSkill(min?: number | null, max?: number | null): string {
  if (min == null && max == null) return "";
  if (min != null && max != null) {
    if (min === max) return `NTRP ${min.toFixed(1)}`;
    return `NTRP ${min.toFixed(1)}–${max.toFixed(1)}`;
  }
  if (min != null) return `NTRP ${min.toFixed(1)}+`;
  return `NTRP up to ${max!.toFixed(1)}`;
}

export function buildLfpShare(post: LfpSharePost): LfpSharePayload {
  const players = post.playersNeeded ?? 0;
  const playerWord = players === 1 ? "player" : "players";
  const headline = players > 0
    ? `Looking for ${players} ${playerWord}`
    : `Looking for players`;
  const gameSuffix = post.gameType ? ` — ${formatGameType(post.gameType)} tennis` : ` — tennis`;
  const title = `🎾 ${headline}${gameSuffix}`;

  const lines: string[] = [title, ""];

  const whenParts: string[] = [];
  if (post.playDate) whenParts.push(formatPlayDate(post.playDate));
  if (post.playTime) whenParts.push(formatPlayTime(post.playTime));
  let whenLine = whenParts.join(" · ");
  if (post.playDuration) {
    whenLine = whenLine ? `${whenLine} (${post.playDuration} min)` : `${post.playDuration} min`;
  }
  if (whenLine) lines.push(whenLine);

  if (post.courtLocation) lines.push(`📍 ${post.courtLocation}`);

  const skill = formatSkill(post.skillMin, post.skillMax);
  if (skill) lines.push(`🎯 ${skill}`);

  // Strip the trailing blank if no detail lines were added.
  if (lines[lines.length - 1] === "") lines.pop();

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = `${origin}/p/${post.id}`;

  // Web Share API platforms put `text` and `url` into separate slots; some
  // (Safari/iOS) concatenate them automatically with a newline. Including the
  // URL only in the `url` field avoids it appearing twice on iOS while still
  // showing up for the clipboard fallback (we append it manually there).
  const text = lines.join("\n");

  return { title, text, url };
}

export function canNativeShare(): boolean {
  if (typeof navigator === "undefined") return false;
  return typeof navigator.share === "function";
}

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

export async function shareLfp(payload: LfpSharePayload): Promise<ShareOutcome> {
  if (canNativeShare()) {
    try {
      await navigator.share({
        title: payload.title,
        text: payload.text,
        url: payload.url,
      });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
      // Fall through to clipboard if the platform rejected the payload.
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(`${payload.text}\n${payload.url}`);
      return "copied";
    } catch {
      return "failed";
    }
  }

  return "failed";
}
