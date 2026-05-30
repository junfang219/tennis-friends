"use client";

import { useCallback, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { sendChatMessage } from "@/lib/supabase/queries";
import { isWithinPromptWindow } from "@/lib/courtPrompt";

// In-chat "are courts open right now?" prompt for a confirmed game. Rendered
// as the last item in the game's group-chat thread during the game window.
// Unlike CourtStatusReporter (manual, GPS-gated, no game), this carries the
// game's post_id: the report_court_availability RPC then verifies the caller
// is a confirmed participant and that we're inside the game window — so chat
// participation + timing replace the GPS proximity check entirely.
//
// Answering also posts a short message to the chat so the group sees it; Skip
// is silent. Shows once per game per user (localStorage), re-evaluating
// visibility on a 60s tick so it appears at window-open and clears at game end.

type Props = {
  chatId: string;
  postId: string;
  courtId: string;
  startMs: number;
  endMs: number;
  /** Fired after a successful report (e.g. to refresh a banner elsewhere). */
  onAnswered?: () => void;
};

function flagKey(postId: string): string {
  return `courtAvailPrompt:${postId}`;
}

function alreadyAnswered(postId: string): boolean {
  try {
    return localStorage.getItem(flagKey(postId)) !== null;
  } catch {
    return false;
  }
}

function markAnswered(postId: string): void {
  try {
    localStorage.setItem(flagKey(postId), String(Date.now()));
  } catch {
    /* ignore */
  }
}

export function GameCourtPrompt({
  chatId,
  postId,
  courtId,
  startMs,
  endMs,
  onAnswered,
}: Props) {
  const [submitting, setSubmitting] = useState<"yes" | "no" | null>(null);
  const [done, setDone] = useState(false);
  const [dismissed, setDismissed] = useState(() => alreadyAnswered(postId));
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(endMs); // seeded so first paint is deterministic

  // Re-evaluate the window each minute: the card appears at start−30 and
  // clears at game end without a reload.
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const submit = useCallback(
    async (hasEmpty: boolean) => {
      setSubmitting(hasEmpty ? "yes" : "no");
      setError(null);
      try {
        const supabase = createSupabaseBrowserClient();
        const { error: rpcError } = await supabase.rpc("report_court_availability", {
          p_court_id: courtId,
          p_has_empty: hasEmpty,
          p_post_id: postId,
        });
        if (rpcError) {
          setError(rpcError.message || "Couldn't send your report.");
          return;
        }
        markAnswered(postId);
        // Announce to the group. A failure here doesn't undo the report, so
        // don't surface it — the report (the important part) already landed.
        try {
          await sendChatMessage(
            supabase,
            chatId,
            hasEmpty
              ? "🎾 Told the map there are open courts here"
              : "🎾 Told the map all courts are full here"
          );
        } catch {
          /* ignore announce failure */
        }
        setDone(true);
        onAnswered?.();
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setSubmitting(null);
      }
    },
    [chatId, courtId, postId, onAnswered]
  );

  function skip() {
    markAnswered(postId);
    setDismissed(true);
  }

  if (dismissed) return null;
  if (!done && !isWithinPromptWindow(startMs, endMs, now)) return null;

  return (
    <div className="mx-auto my-3 max-w-sm rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 shadow-sm">
      {done ? (
        <div className="flex items-center justify-center gap-1.5 py-1 text-court-green">
          <span aria-hidden>✓</span>
          <span className="text-sm font-medium">Thanks! Report sent.</span>
        </div>
      ) : (
        <>
          <p className="text-sm font-semibold text-amber-900">
            Are there open courts for other players right now?
          </p>
          <p className="mt-0.5 text-[11px] text-amber-700/80">
            Your answer shows on this court&apos;s map card.
          </p>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={() => submit(true)}
              disabled={submitting !== null}
              className="flex-1 rounded-lg bg-court-green px-2 py-2 text-sm font-medium text-white hover:bg-court-green-light disabled:opacity-50"
            >
              {submitting === "yes" ? "Sending…" : "Open courts"}
            </button>
            <button
              type="button"
              onClick={() => submit(false)}
              disabled={submitting !== null}
              className="flex-1 rounded-lg bg-white px-2 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              {submitting === "no" ? "Sending…" : "All full"}
            </button>
            <button
              type="button"
              onClick={skip}
              disabled={submitting !== null}
              className="rounded-lg px-2 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
            >
              Skip
            </button>
          </div>
          {error && (
            <p className="mt-2 rounded-lg border border-red-100 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-600">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
