"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

// Two-step sign-up using Supabase's email OTP flow instead of a magic
// link. The magic-link form requires the user to click the email link
// in the same browser/cookie context as the signup form — that's broken
// on the Capacitor + iOS Simulator combo because the simulator's
// WebView is a separate cookie jar from Mac Safari (where the email
// gets opened).
//
// With OTP the user receives a 6-digit code, types it into the app, and
// gets a session in the simulator directly. Same flow works on web,
// real iPhone Mail, etc.

export default function SupabaseRegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<"form" | "code">("form");
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
      // Create the account with a password the user can use later, then
      // send a one-time code to verify the email. Supabase combines these
      // by accepting the OTP type via verifyOtp(); the password we set
      // here is what they'll use on subsequent /login visits.
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        // Trim so the profile.name row doesn't end up with trailing whitespace
        // (the handle_new_user trigger copies this verbatim into profiles).
        options: { data: { name: name.trim() } },
      });
      if (signUpError) {
        setError(signUpError.message);
        return;
      }
      if (data.session) {
        // Email confirmation disabled at the project level — straight to onboarding.
        router.push("/onboarding");
        router.refresh();
        return;
      }
      // Email confirmation required: the signUp call already triggered an
      // OTP email. Move to the code-entry step.
      setStep("code");
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
        setError(verifyError.message);
        return;
      }
      router.push("/onboarding");
      router.refresh();
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
      if (resendError) setError(resendError.message);
    } finally {
      setBusy(false);
    }
  }

  async function onOAuth(provider: "google") {
    setError(null);
    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/onboarding")}`,
      },
    });
    if (oauthError) {
      setError(oauthError.message);
      setBusy(false);
    }
  }

  if (step === "code") {
    return (
      <main className="mx-auto max-w-md p-6 pt-16">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Enter the code</h1>
        <p className="text-gray-600 mb-6 text-sm">
          We sent a 6-digit code to <strong>{email}</strong>. It expires in
          about an hour.
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
              setStep("form");
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
      <form onSubmit={onSubmitForm} className="space-y-3">
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

      <div className="mt-4 flex items-center gap-3 text-xs text-gray-500">
        <div className="flex-1 h-px bg-gray-200" />
        <span>or</span>
        <div className="flex-1 h-px bg-gray-200" />
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => onOAuth("google")}
          disabled={busy}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          Continue with Google
        </button>
      </div>

      <p className="mt-6 text-sm text-gray-600">
        Already have an account?{" "}
        <Link href="/login" className="text-green-700 hover:underline">
          Log in
        </Link>
      </p>
    </main>
  );
}
