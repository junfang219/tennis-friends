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
export type ShareResult = { outcome: ShareOutcome; error?: string };

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export async function shareLfp(payload: LfpSharePayload): Promise<ShareResult> {
  // Native Capacitor first. Required on iOS because the dev server (and any
  // non-HTTPS context) blocks navigator.share / navigator.clipboard — those
  // are both secure-context-only Web APIs. The Capacitor Share plugin goes
  // through the native bridge and has no such restriction, so it works in
  // both dev (mDNS over HTTP) and prod (HTTPS) identically.
  let lastError: string | undefined;
  try {
    const core = await import("@capacitor/core");
    if (core.Capacitor.isNativePlatform()) {
      // If the JS thinks Share is missing, the native plugin pod isn't
      // registered — almost always means `npx cap sync ios` wasn't run after
      // installing @capacitor/share, or Xcode didn't refresh the workspace.
      if (!core.Capacitor.isPluginAvailable("Share")) {
        const msg = "Share plugin not registered. Run `npx cap sync ios` and rebuild.";
        console.error("[lfpShare]", msg);
        return { outcome: "failed", error: msg };
      }
      try {
        const { Share } = await import("@capacitor/share");
        await Share.share({
          title: payload.title,
          text: payload.text,
          url: payload.url,
        });
        return { outcome: "shared" };
      } catch (err) {
        // iOS rejects with "Share canceled" when the user dismisses the
        // sheet; treat that as a quiet cancel, not a failure.
        const msg = errMsg(err);
        console.error("[lfpShare] Share.share threw:", msg, err);
        if (/cancel/i.test(msg)) return { outcome: "cancelled" };
        lastError = msg;
        // Any other native error falls through to the web paths so we still
        // have a chance to surface something useful — but if those also fail,
        // we report this native error since it's the most actionable.
      }
    }
  } catch (err) {
    console.error("[lfpShare] @capacitor/core import failed:", errMsg(err));
  }

  if (canNativeShare()) {
    try {
      await navigator.share({
        title: payload.title,
        text: payload.text,
        url: payload.url,
      });
      return { outcome: "shared" };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return { outcome: "cancelled" };
      }
      const msg = errMsg(err);
      console.error("[lfpShare] navigator.share threw:", msg, err);
      lastError = lastError ?? msg;
      // Fall through to clipboard if the platform rejected the payload.
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(`${payload.text}\n${payload.url}`);
      return { outcome: "copied" };
    } catch (err) {
      const msg = errMsg(err);
      console.error("[lfpShare] clipboard.writeText threw:", msg, err);
      lastError = lastError ?? msg;
    }
  }

  return { outcome: "failed", error: lastError };
}
