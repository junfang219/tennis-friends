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

export type SharePayload = { title: string; text: string; url: string };
// Back-compat alias for callers built against the LFP-specific name. The
// payload shape is identical — title / text / url is the same triple the Web
// Share API and Capacitor Share both accept.
export type LfpSharePayload = SharePayload;

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

// Generic share routine: Capacitor native first (works on iOS dev server),
// then Web Share API, then clipboard fallback. Used by every share call site
// in the app — pass a logTag for legible console traces when a target fails.
export async function nativeShare(
  payload: SharePayload,
  logTag = "share",
): Promise<ShareResult> {
  let lastError: string | undefined;
  try {
    const core = await import("@capacitor/core");
    if (core.Capacitor.isNativePlatform()) {
      // If the JS thinks Share is missing, the native plugin pod isn't
      // registered — almost always means `npx cap sync ios` wasn't run after
      // installing @capacitor/share, or Xcode didn't refresh the workspace.
      if (!core.Capacitor.isPluginAvailable("Share")) {
        const msg = "Share plugin not registered. Run `npx cap sync ios` and rebuild.";
        console.error(`[${logTag}]`, msg);
        return { outcome: "failed", error: msg };
      }
      try {
        const { Share } = await import("@capacitor/share");
        // Only include fields with non-empty values. iOS UIActivityViewController
        // turns an empty-string `url: ""` into a URL activity item anyway, which
        // makes Messages render a link card and drop the text body. Omitting the
        // field entirely is what forces Messages to send plain text.
        const opts: { title?: string; text?: string; url?: string } = {};
        if (payload.title) opts.title = payload.title;
        if (payload.text) opts.text = payload.text;
        if (payload.url) opts.url = payload.url;
        await Share.share(opts);
        return { outcome: "shared" };
      } catch (err) {
        const msg = errMsg(err);
        console.error(`[${logTag}] Share.share threw:`, msg, err);
        if (/cancel/i.test(msg)) return { outcome: "cancelled" };
        lastError = msg;
        // Fall through to the web paths.
      }
    }
  } catch (err) {
    console.error(`[${logTag}] @capacitor/core import failed:`, errMsg(err));
  }

  if (canNativeShare()) {
    try {
      // Same omit-when-empty discipline as the native path above — some browsers
      // (Safari) render text+url as a link preview when both are present.
      const opts: ShareData = {};
      if (payload.title) opts.title = payload.title;
      if (payload.text) opts.text = payload.text;
      if (payload.url) opts.url = payload.url;
      await navigator.share(opts);
      return { outcome: "shared" };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return { outcome: "cancelled" };
      }
      const msg = errMsg(err);
      console.error(`[${logTag}] navigator.share threw:`, msg, err);
      lastError = lastError ?? msg;
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      const clipText = payload.url ? `${payload.text}\n${payload.url}` : payload.text;
      await navigator.clipboard.writeText(clipText);
      return { outcome: "copied" };
    } catch (err) {
      const msg = errMsg(err);
      console.error(`[${logTag}] clipboard.writeText threw:`, msg, err);
      lastError = lastError ?? msg;
    }
  }

  return { outcome: "failed", error: lastError };
}

export async function shareLfp(payload: LfpSharePayload): Promise<ShareResult> {
  // Native Capacitor first. Required on iOS because the dev server (and any
  // non-HTTPS context) blocks navigator.share / navigator.clipboard — those
  // are both secure-context-only Web APIs. The Capacitor Share plugin goes
  // through the native bridge and has no such restriction, so it works in
  // both dev (mDNS over HTTP) and prod (HTTPS) identically.
  return nativeShare(payload, "lfpShare");
}
