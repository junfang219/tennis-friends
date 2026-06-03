"use client";

import Link from "next/link";
import { AppleIcon, GoogleIcon } from "@/app/components/ui/icons";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { authErrorMessage } from "@/lib/supabase/authError";
import { useIsNative } from "@/hooks/useIsNative";
import { useIsEmbeddedBrowser } from "@/hooks/useIsEmbeddedBrowser";
import { EmbeddedBrowserNotice } from "@/components/EmbeddedBrowserNotice";
import {
  signInWithGoogleNative,
  signInWithAppleNative,
  destinationAfterNativeAuth,
  googleNativeConfigured,
} from "@/lib/auth/googleNative";

// Login mirrors /register: social-first, email/password collapsed
// behind a toggle. Same rationale — OAuth is instant; email is the
// fallback for users who created their account that way.

export default function SupabaseLoginPage() {
  const router = useRouter();
  const search = useSearchParams();
  // On the web, Google sign-in uses the standard OAuth redirect. In the native
  // shell that redirect can't run (Google blocks embedded WebViews), so we use
  // native Google Sign-In instead — but only once its client IDs are configured
  // (googleNativeConfigured). Until then the button stays hidden on native so we
  // never show a guaranteed-to-fail button. (Web always shows it.)
  const isNative = useIsNative();
  // Detect in-app browsers (Instagram, Facebook, etc.) where Google's OAuth
  // flow fails with `disallowed_useragent`. We hide the Google button there
  // and show a banner pointing the user to Safari or email signup.
  const embeddedBrowser = useIsEmbeddedBrowser();
  const showGoogle = (!isNative || googleNativeConfigured) && !embeddedBrowser;
  // Some callers use `?next=...` (e.g. /invite/[token], /register), others
  // use `?redirectTo=...`. Accept either so neither flow drops the return URL.
  const redirectTo = search.get("redirectTo") ?? search.get("next") ?? "/";
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `?deleted=1` is set by the post-delete redirect in Settings → Danger zone.
  // Seed the banner from the URL on first render, then strip the param so a
  // page refresh doesn't keep showing it.
  const [showDeletedBanner, setShowDeletedBanner] = useState(
    () => search.get("deleted") === "1"
  );
  useEffect(() => {
    if (search.get("deleted") === "1") {
      const next = new URLSearchParams(search.toString());
      next.delete("deleted");
      const qs = next.toString();
      router.replace(qs ? `/login?${qs}` : "/login");
    }
  }, [search, router]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        setError(authErrorMessage(signInError));
        return;
      }
      router.push(redirectTo);
      router.refresh();
    } catch (err) {
      // signInWithPassword can throw on a network-layer failure rather
      // than returning { error } — catch it so the user gets a clear
      // message instead of an unhandled rejection.
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onOAuth(provider: "google" | "apple") {
    setError(null);
    setBusy(true);
    const supabase = createSupabaseBrowserClient();

    // In the native shell, OAuth can't use the WebView redirect (Google blocks
    // embedded user agents; Apple's redirect hits a PKCE-verifier dead end) —
    // go through the native sign-in sheet + signInWithIdToken, then route by
    // onboarding state ourselves (no /auth/callback round-trip). Web keeps the
    // standard redirect.
    if (isNative && (provider === "google" || provider === "apple")) {
      try {
        if (provider === "google") await signInWithGoogleNative(supabase);
        else await signInWithAppleNative(supabase);
        router.push(await destinationAfterNativeAuth(supabase, redirectTo));
      } catch (err) {
        // A user dismissing the Google sheet lands here too — stay quiet for
        // cancels, surface everything else.
        if (!/cancel/i.test(err instanceof Error ? err.message : "")) {
          setError(authErrorMessage(err));
        }
        setBusy(false);
      }
      return;
    }

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`,
      },
    });
    if (oauthError) {
      setError(authErrorMessage(oauthError));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md p-6 pt-16">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Log in</h1>

      {showDeletedBanner && (
        <div
          role="status"
          className="mb-4 flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
        >
          <span className="flex-1">Your account has been deleted.</span>
          <button
            type="button"
            onClick={() => setShowDeletedBanner(false)}
            aria-label="Dismiss"
            className="text-green-700 hover:text-green-900"
          >
            ×
          </button>
        </div>
      )}

      {embeddedBrowser && <EmbeddedBrowserNotice appName={embeddedBrowser.app} />}

      <div className="space-y-2">
        {showGoogle && (
          <button
            type="button"
            onClick={() => onOAuth("google")}
            disabled={busy}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 font-medium"
          >
            <GoogleIcon />
            Continue with Google
          </button>
        )}
        <button
          type="button"
          onClick={() => onOAuth("apple")}
          disabled={busy}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-black text-white rounded-lg hover:bg-gray-900 disabled:opacity-50 font-medium"
        >
          <AppleIcon />
          Continue with Apple
        </button>
      </div>

      {showEmailForm ? (
        <>
          <div className="mt-6 flex items-center gap-3 text-xs text-gray-500">
            <div className="flex-1 h-px bg-gray-200" />
            <span>or with email</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>
          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            <input
              type="email"
              required
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              autoComplete="email"
            />
            <input
              type="password"
              required
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              autoComplete="current-password"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {busy ? "Signing in…" : "Log in"}
            </button>
          </form>
        </>
      ) : (
        <>
          <div className="mt-6 flex items-center gap-3 text-xs text-gray-500">
            <div className="flex-1 h-px bg-gray-200" />
            <span>or</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>
          <button
            type="button"
            onClick={() => setShowEmailForm(true)}
            className="mt-4 w-full text-sm text-gray-600 hover:text-gray-900 underline underline-offset-2"
          >
            Log in with email instead
          </button>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </>
      )}

      <div className="mt-6 flex justify-between text-sm text-gray-600">
        <Link href="/auth/reset" className="text-green-700 hover:underline">
          Forgot password?
        </Link>
        <Link
          href={redirectTo === "/" ? "/register" : `/register?next=${encodeURIComponent(redirectTo)}`}
          className="text-green-700 hover:underline"
        >
          Create account
        </Link>
      </div>
    </main>
  );
}
