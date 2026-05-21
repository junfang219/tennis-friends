"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function SupabaseLoginPage() {
  const router = useRouter();
  const search = useSearchParams();
  const redirectTo = search.get("redirectTo") ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setError(signInError.message);
        return;
      }
      router.push(redirectTo);
      router.refresh();
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
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`,
      },
    });
    if (oauthError) {
      setError(oauthError.message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md p-6 pt-16">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Log in</h1>

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

      <div className="mt-4 flex items-center gap-3 text-xs text-gray-500">
        <div className="flex-1 h-px bg-gray-200" />
        <span>or</span>
        <div className="flex-1 h-px bg-gray-200" />
      </div>

      <div className="mt-4 space-y-2">
        <button
          type="button"
          onClick={() => onOAuth("google")}
          disabled={busy}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          Continue with Google
        </button>
        <button
          type="button"
          onClick={() => onOAuth("apple")}
          disabled={busy}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          Continue with Apple
        </button>
      </div>

      <div className="mt-6 flex justify-between text-sm text-gray-600">
        <Link href="/auth/reset" className="text-green-700 hover:underline">
          Forgot password?
        </Link>
        <Link href="/auth/register" className="text-green-700 hover:underline">
          Create account
        </Link>
      </div>
    </main>
  );
}
