"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

// Native Google Sign-In for the Capacitor iOS/Android shell.
//
// Google blocks OAuth inside embedded WebViews (disallowed_useragent), so the
// web `signInWithOAuth` redirect can't run in the app. Instead we use the
// native Google sheet (@capgo/capacitor-social-login) to obtain an OIDC ID
// token and hand it straight to Supabase via `signInWithIdToken` — no browser
// redirect, no /auth/callback round-trip.
//
// ── CONFIG ──────────────────────────────────────────────────────────────────
// These are PUBLIC OAuth client identifiers (safe to commit) — not secrets.
// Fill them from Google Cloud Console before the next TestFlight build:
//   • iOS client  — OAuth client of type "iOS", bundle id `com.tennisfriend.app`.
//                   Google also gives a "reversed client ID" — add THAT to
//                   ios/App/App/Info.plist as a CFBundleURLTypes URL scheme.
//   • web client  — the SAME OAuth client Supabase's Google provider already
//                   uses for web sign-in. Passing it as the native SDK's
//                   serverClientId makes the ID token's `aud` a client Supabase
//                   trusts. Add BOTH client IDs to Supabase → Auth → Providers →
//                   Google → "Authorized Client IDs".
//
// Read via the LITERAL `process.env.NEXT_PUBLIC_*` form so Webpack inlines the
// value into the client bundle (dynamic-key reads are undefined in the browser
// — see lib/supabase/env.ts).
const PLACEHOLDER_PREFIX = "PLACEHOLDER";

export const GOOGLE_IOS_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID ??
  `${PLACEHOLDER_PREFIX}_IOS.apps.googleusercontent.com`;

export const GOOGLE_WEB_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID ??
  `${PLACEHOLDER_PREFIX}_WEB.apps.googleusercontent.com`;

/**
 * True only once real client IDs are configured (not the placeholders above).
 * The Google button stays hidden on native until this is true, so a build made
 * before the IDs are filled in won't show a button that's guaranteed to fail.
 */
export const googleNativeConfigured =
  !GOOGLE_IOS_CLIENT_ID.startsWith(PLACEHOLDER_PREFIX) &&
  !GOOGLE_WEB_CLIENT_ID.startsWith(PLACEHOLDER_PREFIX);

let initialized = false;

async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  const { SocialLogin } = await import("@capgo/capacitor-social-login");
  await SocialLogin.initialize({
    google: {
      webClientId: GOOGLE_WEB_CLIENT_ID,
      iOSClientId: GOOGLE_IOS_CLIENT_ID,
    },
  });
  initialized = true;
}

/**
 * Run the native Google sign-in flow and exchange the ID token for a Supabase
 * session. Throws on failure (including user-cancel) — the caller owns the
 * error UI. Only call inside the native shell (gate on `useIsNative()`).
 */
export async function signInWithGoogleNative(
  supabase: SupabaseClient<Database>
): Promise<void> {
  await ensureInitialized();
  const { SocialLogin } = await import("@capgo/capacitor-social-login");

  const res = await SocialLogin.login({
    provider: "google",
    options: { scopes: ["email", "profile"] },
  });

  // The Google login result carries the OIDC ID token we trade for a session.
  const result = res?.result as { idToken?: string | null } | undefined;
  const idToken = result?.idToken;
  if (!idToken) {
    throw new Error("Google sign-in didn't return an ID token.");
  }

  // No nonce: the native SDK isn't issued one here, so the ID token has no
  // nonce claim and Supabase verifies it without one. (If Supabase ever
  // rejects on a nonce mismatch, generate a raw nonce, pass it to
  // SocialLogin.login, and forward the same raw value here.)
  const { error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
  });
  if (error) throw error;
}

/**
 * Where to send the user after a successful NATIVE sign-in. The native flow
 * sets the session client-side and never hits /auth/callback, so this mirrors
 * that route's onboarding routing: unfinished onboarding → /onboarding
 * (preserving `next`); otherwise → `next` (but never bounce a returning user
 * back into /onboarding).
 */
export async function destinationAfterNativeAuth(
  supabase: SupabaseClient<Database>,
  next: string
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "/";

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_complete")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.onboarding_complete) {
    return next && next !== "/onboarding"
      ? `/onboarding?next=${encodeURIComponent(next)}`
      : "/onboarding";
  }
  if (next === "/onboarding") return "/";
  return next;
}
