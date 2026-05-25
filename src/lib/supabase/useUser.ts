"use client";

import { useAuthSnapshot } from "./auth-store";

/**
 * Client-side hook for the current Supabase user. Replaces the NextAuth
 * `useSession()` pattern across pages and components.
 *
 * Usage:
 *   const { user, loading } = useSupabaseUser();
 *   if (loading) return <Spinner />;
 *   if (!user) return <SignInPrompt />;
 *   return <Feed userId={user.id} />;
 *
 * Backed by a shared module-level auth snapshot so every consumer in the
 * tree sees the same loading→loaded transition exactly once per page load —
 * not once per component.
 */
export function useSupabaseUser() {
  const { user, loaded } = useAuthSnapshot();
  return { user, loading: !loaded };
}
