// Extract a human-readable message from an unknown thrown value.
//
// Why this exists: Supabase's PostgrestError is a plain object
// ({ message, code, details, hint }), not an instance of Error. The reflex
// pattern `err instanceof Error ? err.message : "fallback"` therefore
// swallows the real Postgres error (RLS denial, unique violation, NULL
// constraint, the geography-search_path bug from 2026-05-28, …) and shows
// the generic fallback instead. Funnel every catch through here so the
// underlying message reaches the UI.

/** Pull the best available message out of an unknown thrown value. */
export function toErrorMessage(err: unknown): string | null {
  if (err instanceof Error) return err.message;
  if (
    err !== null &&
    typeof err === "object" &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return null;
}

/** Same as toErrorMessage, but returns `fallback` if no message can be extracted. */
export function errorMessage(err: unknown, fallback: string): string {
  return toErrorMessage(err) ?? fallback;
}

/** Wrap an unknown thrown value as an Error, preserving the original message. */
export function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  const message = toErrorMessage(err);
  if (message !== null) {
    const e = new Error(message);
    if (err !== null && typeof err === "object") Object.assign(e, err);
    return e;
  }
  return new Error(String(err));
}
