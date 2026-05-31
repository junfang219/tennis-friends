"use client";

import Link from "next/link";
import { AppleIcon, GoogleIcon } from "@/app/components/ui/icons";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { emailExists, isExistingEmailSignUp } from "@/lib/supabase/signup";
import { authErrorMessage } from "@/lib/supabase/authError";

// Sign-up is social-first: Google + Apple are the headline buttons and
// the email/password form is collapsed behind a toggle. Reason: email
// OTP delivery is the slowest, most failure-prone path (spam filters,
// SMTP delays). OAuth lands in <2s with no email round-trip.
//
// The email step uses Supabase's OTP flow rather than a magic link
// because the link requires the user to click in the same browser/cookie
// context as the signup form — that's broken in the Capacitor iOS
// Simulator (the simulator's WebView is a separate cookie jar from Mac
// Safari). With OTP the user types a 6-digit code in the app directly.

type Step = "choose" | "email-form" | "code";

// Only honor on-site, relative paths. Lets us pass a `next=/p/abc` from a
// public share landing without ever bouncing the user to an external host.
function safeNext(value: string | null | undefined): string {
  if (!value) return "/onboarding";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return "/onboarding";
}

export default function SupabaseRegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNext(searchParams.get("next"));
  const [step, setStep] = useState<Step>("choose");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmitForm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();

      // Reliable duplicate check before signUp. signUp's anti-enumeration
      // response doesn't flag emails that exist only via an OAuth identity
      // (e.g. a Google account with no password), so without this an
      // already-registered email would be sent to the OTP step.
      if (await emailExists(supabase, email)) {
        setError(
          "An account with this email already exists. Try logging in instead."
        );
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        // Trim so the profile.name row doesn't end up with trailing whitespace
        // (the handle_new_user trigger copies this verbatim into profiles).
        options: { data: { name: name.trim() } },
      });
      if (signUpError) {
        // Covers the confirmation-disabled duplicate ("User already
        // registered"), the email-send rate limit (429, common when
        // re-testing), and network failures ("Load failed").
        setError(authErrorMessage(signUpError));
        return;
      }
      if (isExistingEmailSignUp(data)) {
        // With confirmation enabled, Supabase hides duplicate emails behind
        // a decoy response instead of erroring. Catch it so we don't send
        // the user to the code step with an OTP that never arrives.
        setError(
          "An account with this email already exists. Try logging in instead."
        );
        return;
      }
      if (data.session) {
        // Email confirmation disabled at the project level — straight to onboarding.
        router.push(`/onboarding?next=${encodeURIComponent(nextPath)}`);
        router.refresh();
        return;
      }
      // Email confirmation required: signUp triggered the OTP. Move to entry.
      setStep("code");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onVerifyCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: code.trim(),
        type: "email",
      });
      if (verifyError) {
        setError(authErrorMessage(verifyError));
        return;
      }
      router.push(`/onboarding?next=${encodeURIComponent(nextPath)}`);
      router.refresh();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onResendCode() {
    setError(null);
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email,
      });
      if (resendError) setError(authErrorMessage(resendError));
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onOAuth(provider: "google" | "apple") {
    setError(null);
    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
      },
    });
    if (oauthError) {
      setError(authErrorMessage(oauthError));
      setBusy(false);
    }
  }

  if (step === "code") {
    return (
      <main className="mx-auto max-w-md p-6 pt-16">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Enter the code</h1>
        <p className="text-gray-600 mb-6 text-sm">
          We sent a 6-digit code to <strong>{email}</strong>. It expires in
          about an hour. Check your spam folder if it doesn&apos;t arrive in a minute.
        </p>
        <form onSubmit={onVerifyCode} className="space-y-3">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-2xl tracking-[0.5em] text-center focus:outline-none focus:ring-2 focus:ring-green-500"
            autoFocus
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy || code.length < 6}
            className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {busy ? "Verifying…" : "Verify"}
          </button>
        </form>
        <div className="mt-6 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => {
              setStep("email-form");
              setCode("");
              setError(null);
            }}
            className="text-gray-500 hover:text-gray-700"
          >
            ← Different email
          </button>
          <button
            type="button"
            onClick={onResendCode}
            disabled={busy}
            className="text-green-700 hover:underline disabled:opacity-50"
          >
            Resend code
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-6 pt-16">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Create account</h1>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => onOAuth("google")}
          disabled={busy}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 font-medium"
        >
          <GoogleIcon />
          Continue with Google
        </button>
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

      {step === "choose" ? (
        <>
          <div className="mt-6 flex items-center gap-3 text-xs text-gray-500">
            <div className="flex-1 h-px bg-gray-200" />
            <span>or</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>
          <button
            type="button"
            onClick={() => setStep("email-form")}
            className="mt-4 w-full text-sm text-gray-600 hover:text-gray-900 underline underline-offset-2"
          >
            Sign up with email instead
          </button>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </>
      ) : (
        <>
          <div className="mt-6 flex items-center gap-3 text-xs text-gray-500">
            <div className="flex-1 h-px bg-gray-200" />
            <span>or with email</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>
          <form onSubmit={onSubmitForm} className="mt-4 space-y-3">
            <input
              type="text"
              required
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              autoComplete="name"
            />
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
              minLength={8}
              placeholder="Password (8+ chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              autoComplete="new-password"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {busy ? "Creating account…" : "Create account"}
            </button>
          </form>
        </>
      )}

      <p className="mt-6 text-sm text-gray-600">
        Already have an account?{" "}
        <Link href="/login" className="text-green-700 hover:underline">
          Log in
        </Link>
      </p>
    </main>
  );
}
