"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { claimRosterPlaceholder } from "@/lib/supabase/queries";
import { errorMessage } from "@/lib/errorMessage";

/**
 * Authenticated auto-claim runner. After a guest creates an account, the
 * ?next=/rsvp-claim/<token> thread brings them back here signed in, where we
 * merge their placeholder roster slot into the new account and drop them on the
 * team's availability page. Mirrors invite/[token] (auto-run-once via ref).
 */
export default function RsvpClaimPage() {
  const params = useParams();
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const token = params.token as string;

  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState("");

  const claim = useCallback(async () => {
    setClaiming(true);
    setClaimError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const result = await claimRosterPlaceholder(supabase, token);
      router.replace(`/groups/${result.group_id}/availability`);
    } catch (err) {
      setClaimError(errorMessage(err, "Couldn't link your RSVP slot to your account."));
      setClaiming(false);
    }
  }, [router, token]);

  // Unauthenticated → send to signup, threading the return path so they come
  // back here signed in. (register honors a relative ?next= via safeNext.)
  useEffect(() => {
    if (sessionStatus === "unauthenticated") {
      router.replace(`/register?next=${encodeURIComponent(`/rsvp-claim/${token}`)}`);
    }
  }, [sessionStatus, router, token]);

  // Auto-claim once signed in. Clicking through signup is the consent; the ref
  // guards against re-fires from session/state dep changes.
  const autoAttempted = useRef(false);
  useEffect(() => {
    if (!autoAttempted.current && sessionStatus === "authenticated") {
      autoAttempted.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void claim();
    }
  }, [sessionStatus, claim]);

  return (
    <Centered>
      <div className="bg-white rounded-3xl shadow-sm border border-court-green-pale/20 p-8 max-w-sm">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-court-green to-court-green-soft flex items-center justify-center text-white text-3xl">
          🎾
        </div>
        <h1 className="font-display text-xl font-bold text-gray-900 mt-4">Linking your RSVPs</h1>
        {claimError ? (
          <>
            <p className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {claimError}
            </p>
            <button
              onClick={() => void claim()}
              disabled={claiming}
              className="btn-primary mt-4 w-full"
            >
              {claiming ? "Linking…" : "Try again"}
            </button>
            <Link
              href="/"
              className="mt-3 block text-center text-sm font-medium text-gray-400 hover:text-gray-600"
            >
              Go home
            </Link>
          </>
        ) : (
          <p className="mt-3 text-sm text-gray-500">
            Connecting your availability to your new account…
          </p>
        )}
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="text-center">{children}</div>
    </div>
  );
}
