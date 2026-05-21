"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "./browser";

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
 * Subscribes to auth state changes so the UI updates when the user signs
 * in or out without a full page reload.
 */
export function useSupabaseUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}
