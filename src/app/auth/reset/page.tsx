"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { authErrorMessage } from "@/lib/supabase/authError";

// Password reset is OTP-based, not link-based, to match the Supabase
// "Reset password" email template (uses {{ .Token }}, not
// {{ .ConfirmationURL }}). Same rationale as the signup OTP flow: a
// magic link requires the user to click in the same browser/cookie
// context as the form, which breaks in the Capacitor iOS Simulator and
// in any case is worse UX than typing 6 digits.
//
// Flow: enter email → resetPasswordForEmail → enter code + new password →
// verifyOtp(type: 'recovery') establishes a session → updateUser sets
// the new password → straight to home.

type Step = "email" | "code";

export default function SupabaseResetPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSendCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email);
      if (resetError) {
        setError(authErrorMessage(resetError));
        return;
      }
      setStep("code");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitNewPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: code.trim(),
        type: "recovery",
      });
      if (verifyError) {
        setError(authErrorMessage(verifyError));
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(authErrorMessage(updateError));
        return;
      }
      router.push("/");
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
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email);
      if (resetError) setError(authErrorMessage(resetError));
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (step === "code") {
    return (
      <main className="mx-auto max-w-md p-6 pt-16">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Set a new password</h1>
        <p className="text-gray-600 mb-6 text-sm">
          We sent a 6-digit code to <strong>{email}</strong>. Enter it
          below along with your new password. Check your spam folder if it
          doesn&apos;t arrive in a minute.
        </p>
        <form onSubmit={onSubmitNewPassword} className="space-y-3">
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
          <input
            type="password"
            required
            minLength={8}
            placeholder="New password (8+ chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            autoComplete="new-password"
          />
          <input
            type="password"
            required
            minLength={8}
            placeholder="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            autoComplete="new-password"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy || code.length < 6}
            className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {busy ? "Updating…" : "Update password"}
          </button>
        </form>
        <div className="mt-6 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => {
              setStep("email");
              setCode("");
              setPassword("");
              setConfirm("");
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
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Reset your password</h1>
      <form onSubmit={onSendCode} className="space-y-3">
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
          autoComplete="email"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send reset code"}
        </button>
      </form>
      <p className="mt-6 text-sm text-gray-600">
        <Link href="/login" className="text-green-700 hover:underline">
          Back to login
        </Link>
      </p>
    </main>
  );
}
