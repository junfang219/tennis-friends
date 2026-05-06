export type HandleResult = { ok: true; value: string } | { ok: false; error: string };

/**
 * Validate and normalize a user handle.
 * Strips a leading "@", lowercases, and enforces format rules. The output
 * `value` is what should be persisted (or compared against existing handles).
 */
export function validateHandle(raw: string): HandleResult {
  const stripped = raw.trim().replace(/^@+/, "").toLowerCase();
  if (stripped.length < 3) {
    return { ok: false, error: "Handle must be at least 3 characters." };
  }
  if (stripped.length > 20) {
    return { ok: false, error: "Handle must be 20 characters or fewer." };
  }
  if (!/^[a-z0-9._]+$/.test(stripped)) {
    return { ok: false, error: "Use letters, numbers, dots, and underscores only." };
  }
  if (/^[._]/.test(stripped) || /[._]$/.test(stripped)) {
    return { ok: false, error: "Handle can't start or end with . or _" };
  }
  if (/[._]{2,}/.test(stripped)) {
    return { ok: false, error: "No consecutive . or _" };
  }
  return { ok: true, value: stripped };
}
