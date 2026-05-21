import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "./server";

export interface AuthUser {
  id: string;
  email: string | null;
  phone: string | null;
}

/**
 * Returns the currently signed-in Supabase user, or null if anonymous.
 * Cheap: hits the cached cookie session via @supabase/ssr.
 */
export async function getSupabaseUser(): Promise<AuthUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return {
    id: data.user.id,
    email: data.user.email ?? null,
    phone: data.user.phone ?? null,
  };
}

/**
 * Like getSupabaseUser, but redirects to /login when anonymous. Use as the
 * first line of every authenticated Server Component or Route Handler.
 */
export async function requireSupabaseUser(redirectTo = "/login"): Promise<AuthUser> {
  const user = await getSupabaseUser();
  if (!user) redirect(redirectTo);
  return user;
}
