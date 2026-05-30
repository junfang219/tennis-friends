/**
 * Detects Supabase's "email already registered" signUp response.
 *
 * When email confirmation is enabled, supabase.auth.signUp() does NOT
 * return an error for an email that already exists — that's deliberate
 * anti-enumeration behaviour. It instead returns a decoy user with an
 * empty `identities` array and no session, which looks just like a fresh
 * "confirm your email" signup unless you inspect identities.
 *
 * (When confirmation is disabled, signUp errors with "User already
 * registered" instead, which callers handle via the error branch.)
 *
 * Typed structurally so this stays a dependency-free, client-safe pure
 * helper — keep it out of the server-only ./auth module.
 */
export function isExistingEmailSignUp(data: {
  user: { identities?: unknown[] | null } | null;
  session: unknown | null;
}): boolean {
  return (
    !data.session &&
    !!data.user &&
    Array.isArray(data.user.identities) &&
    data.user.identities.length === 0
  );
}
