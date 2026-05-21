// Robust parser for Postgres timestamptz values as they come back from the
// Supabase JS client.
//
// PostgREST is supposed to emit ISO 8601, but in practice the JS client
// surfaces values formatted as `"2026-05-21 18:23:35.739572+00"` —
// space-separated date/time and a bare `+00` offset. Chrome's permissive
// Date parser accepts that; iOS Safari (and any strict ES spec impl)
// returns NaN, which is why the iPhone simulator was showing "Invalid
// Date" everywhere even though Chrome dev looked fine.
//
// pgToIso normalizes both shapes to a strict ISO 8601 string with a
// `:00`-padded offset, safe to feed into `new Date(...)` on any runtime.

// Trailing "+HH" or "-HH" with no minutes — the bit we need to pad to "+HH:00".
// Anchored to end of string so it can't accidentally bite into "-MM-DD" earlier
// in the timestamp.
const TRAILING_OFFSET_NO_MINUTES_RE = /([+-]\d{2})$/;

export function pgToIso(input: string): string {
  if (!input) return input;
  // Date-only values (no time component) pass through unchanged — wrapping
  // the trailing "-01" of "2026-06-01" as a timezone offset would mangle it.
  const hasTime = input.includes("T") || / \d{2}:\d{2}/.test(input);
  if (!hasTime) return input;
  // Already strictly ISO? Pass through.
  if (input.includes("T") && (input.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(input))) {
    return input;
  }
  // Space → T (PostgREST often emits "2026-05-21 18:23:35...").
  let out = input.replace(" ", "T");
  // Trailing bare "+00" → "+00:00" (strict spec requires ±HH:MM).
  out = out.replace(TRAILING_OFFSET_NO_MINUTES_RE, "$1:00");
  return out;
}

export function pgToDate(input: string): Date {
  return new Date(pgToIso(input));
}
