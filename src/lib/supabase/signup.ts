import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Reliable "is this email already registered?" check, used before signUp.
 *
 * isExistingEmailSignUp (below) only catches emails that already have a
 * PASSWORD identity — signUp's anti-enumeration response doesn't flag an
 * email that exists solely via an OAuth identity (e.g. a Google account
 * with no password), so it would send the user to the OTP step for an
 * account that already exists. This calls the email_exists SECURITY
 * DEFINER RPC (see migration add_email_exists_rpc), which checks
 * auth.users directly and catches every case.
 */
export async function emailExists(
  supabase: SupabaseClient<Database>,
  email: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc("email_exists", {
    p_email: email.trim(),
  });
  if (error) throw error;
  return data === true;
}

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
