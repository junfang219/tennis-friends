"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function SupabaseResetPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/update-password`,
      });
      if (resetError) {
        setError(resetError.message);
        return;
      }
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <main className="mx-auto max-w-md p-6 pt-16">
        <h1 className="text-2xl font-semibold text-gray-900 mb-4">Check your email</h1>
        <p className="text-gray-600">
          If an account exists for <strong>{email}</strong>, we sent a password
          reset link.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-6 pt-16">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Reset your password</h1>
      <form onSubmit={onSubmit} className="space-y-3">
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
          {busy ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <p className="mt-6 text-sm text-gray-600">
        <Link href="/auth/login" className="text-green-700 hover:underline">
          Back to login
        </Link>
      </p>
    </main>
  );
}
