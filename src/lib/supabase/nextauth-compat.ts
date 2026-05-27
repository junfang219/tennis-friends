"use client";

// NextAuth-compatible shim over Supabase Auth.
//
// Exists so the burn-down migration can move pages off `next-auth/react`
// with a one-line import-path change. As each page gets fully rewritten to
// native Supabase queries it should drop this shim and call
// useSupabaseUser() (or the server-side requireSupabaseUser) directly.
//
// What survives from the NextAuth shape:
//   { data: { user: { id, name, email, image } } | null, status, update }
//   signIn(provider, options) — only google + apple supported
//   signOut({ callbackUrl })
//
// What does NOT survive:
//   - Server-side getServerSession (use createSupabaseServerClient instead)
//   - signIn with credentials (use supabase.auth.signInWithPassword)
//   - session.user.image renders the OAuth avatar from user_metadata; if a
//     page needs the canonical avatar it should read profiles.profile_image_url
//   - update() re-fetches the auth user so callers that just mutated
//     user_metadata (e.g. via updateMyProfile) see the new name + avatar
//     immediately instead of waiting for the next page load.

import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "./browser";
import { refreshAuthSnapshot, useAuthSnapshot } from "./auth-store";
import { clearAllCached } from "../queryCache";

interface CompatSession {
  user: {
    id: string;
    name: string;
    email: string | null;
    image: string;
  };
}

type Status = "loading" | "authenticated" | "unauthenticated";

interface UseSessionReturn {
  data: CompatSession | null;
  status: Status;
  update: () => Promise<void>;
}

function toCompatSession(user: User | null): CompatSession | null {
  if (!user) return null;
  const meta = (user.user_metadata ?? {}) as {
    name?: string;
    avatar_url?: string;
    picture?: string;
  };
  return {
    user: {
      id: user.id,
      name: meta.name ?? user.email?.split("@")[0] ?? "",
      email: user.email ?? null,
      image: meta.avatar_url ?? meta.picture ?? "",
    },
  };
}

export function useSession(): UseSessionReturn {
  const { user, loaded } = useAuthSnapshot();

  const status: Status = !loaded
    ? "loading"
    : user
      ? "authenticated"
      : "unauthenticated";

  return {
    data: toCompatSession(user),
    status,
    update: refreshAuthSnapshot,
  };
}

interface SignOutOpts {
  callbackUrl?: string;
}

export async function signOut(opts: SignOutOpts = {}) {
  const supabase = createSupabaseBrowserClient();
  await supabase.auth.signOut();
  // Wipe the in-memory query cache so a subsequent sign-in (or sign-up from
  // the same browser tab) doesn't inherit the previous user's feed/inbox/
  // profile data. window.location.href below normally tears down the page
  // anyway, but signOut is also called from contexts that stay on the same
  // SPA tree.
  clearAllCached();
  const target = opts.callbackUrl ?? "/login";
  if (typeof window !== "undefined") {
    window.location.href = target;
  }
}

interface SignInOpts {
  callbackUrl?: string;
  redirect?: boolean;
}

type SupabaseProvider =
  | "google"
  | "apple"
  | "github"
  | "facebook"
  | "azure"
  | "twitter"
  | "discord";

const SUPPORTED_OAUTH: SupabaseProvider[] = [
  "google",
  "apple",
  "github",
  "facebook",
  "azure",
  "twitter",
  "discord",
];

export async function signIn(
  provider: string,
  opts: SignInOpts = {}
): Promise<{ ok: boolean; error?: string } | undefined> {
  // Validate the provider BEFORE constructing the Supabase client — that
  // way callers passing legacy "credentials" / "phone-otp" don't fail with
  // a confusing env-var error.
  if (!SUPPORTED_OAUTH.includes(provider as SupabaseProvider)) {
    return {
      ok: false,
      error: `signIn(${provider}) is not supported by the Supabase compat shim. Use supabase.auth.signInWithPassword() or signInWithOtp() directly.`,
    };
  }

  const supabase = createSupabaseBrowserClient();
  const redirectTo =
    opts.callbackUrl && typeof window !== "undefined"
      ? new URL(opts.callbackUrl, window.location.origin).toString()
      : undefined;

  const { error } = await supabase.auth.signInWithOAuth({
    provider: provider as SupabaseProvider,
    options: { redirectTo },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Stub for callers that imported getProviders — Supabase doesn't expose this.
export async function getProviders(): Promise<null> {
  return null;
}
