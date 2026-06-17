"use client";

import { useCallback, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { guestCreatePlaceholder } from "@/lib/supabase/queries";
import { errorMessage } from "@/lib/errorMessage";

export default function RsvpTeamSelfAddPage() {
  const params = useParams();
  const router = useRouter();
  const groupToken = params.groupToken as string;

  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const token = await guestCreatePlaceholder(supabase, groupToken, trimmed);
      router.replace(`/rsvp/${token}`);
    } catch (err) {
      setError(
        errorMessage(
          err,
          "This team link is no longer valid or has expired — ask your captain for a new one."
        )
      );
      setSubmitting(false);
    }
  }, [name, submitting, groupToken, router]);

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <div className="rounded-3xl bg-gradient-to-br from-court-green to-court-green-soft p-6 text-white shadow-sm text-center">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-white/20 flex items-center justify-center text-3xl">
          🎾
        </div>
        <h1 className="font-display text-2xl font-bold mt-4">Join the roster</h1>
        <p className="text-sm text-white/80 mt-2">
          Add your name to start setting your availability — no account needed.
        </p>
      </div>

      <div className="mt-6 bg-white rounded-3xl shadow-sm border border-court-green-pale/20 p-6">
        <label htmlFor="name" className="block text-sm font-medium text-gray-700">
          Your name
        </label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          placeholder="e.g. Jordan Lee"
          autoFocus
          className="mt-1.5 w-full rounded-xl border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-court-green focus:border-court-green"
        />
        {error && (
          <p className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          onClick={() => void submit()}
          disabled={!name.trim() || submitting}
          className="btn-primary mt-4 w-full disabled:opacity-50"
        >
          {submitting ? "Adding…" : "Continue"}
        </button>
        <Link
          href="/"
          className="mt-3 block text-center text-sm font-medium text-gray-400 hover:text-gray-600"
        >
          Cancel
        </Link>
      </div>
    </div>
  );
}
