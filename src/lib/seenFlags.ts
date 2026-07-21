// Show-once UI flags backed by localStorage (the GameCourtPrompt pattern,
// extracted for reuse). A flag is "seen" once markFlagSeen ran on this
// device. Storage is injectable for tests; on the server (SSR) flags read as
// seen so one-time UI never flashes during hydration — callers flip to
// visible only after mount.

type FlagStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): FlagStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Storage can throw in privacy modes — treat as unavailable.
    return null;
  }
}

export function hasSeenFlag(key: string, storage: FlagStorage | null = defaultStorage()): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(key) !== null;
  } catch {
    return true;
  }
}

export function markFlagSeen(key: string, storage: FlagStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(key, String(Date.now()));
  } catch {
    // Best effort — a failed write just means the tip shows again next time.
  }
}

// One-time explainer for the team availability matrix (Avail vs Lineup roles).
export const AVAIL_MATRIX_GUIDE_KEY = "tf:seen:avail-matrix-guide";
