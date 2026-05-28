"use client";

import { useState } from "react";
import type { StandingsRowView } from "./types";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { errorMessage } from "@/lib/errorMessage";

export default function ChallengeModal({
  eventId,
  opponent,
  onClose,
  onSent,
}: {
  eventId: string;
  opponent: StandingsRowView;
  onClose: () => void;
  onSent: () => void;
}) {
  const [scheduledAt, setScheduledAt] = useState("");
  const [courtAssign, setCourtAssign] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    setSending(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      // Rank-gap + dedupe + ladder eligibility are enforced server-side
      // by propose_ladder_challenge; client just forwards the inputs.
      const args: {
        p_event_id: string;
        p_opponent_id: string;
        p_scheduled_at?: string;
        p_court_assign: string;
      } = {
        p_event_id: eventId,
        p_opponent_id: opponent.userId,
        p_court_assign: courtAssign,
      };
      if (scheduledAt) args.p_scheduled_at = new Date(scheduledAt).toISOString();
      const { error: rpcErr } = await supabase.rpc("propose_ladder_challenge", args);
      if (rpcErr) throw new Error(rpcErr.message);
      onSent();
    } catch (err) {
      setError(errorMessage(err, "Couldn't send challenge"));
    }
    setSending(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-bold text-gray-900">
          Challenge {opponent.user?.name}
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          They&apos;re ranked #{opponent.rank}. If they accept, you both play and the
          winner takes the higher rank.
        </p>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-gray-500">When (optional)</span>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-500">Court (optional)</span>
            <input
              type="text"
              value={courtAssign}
              onChange={(e) => setCourtAssign(e.target.value)}
              placeholder="e.g. Court 3 at Magnuson"
              className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
            />
          </label>
        </div>

        {error && (
          <div className="mt-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={send}
            disabled={sending}
            className="flex-1 px-4 py-2 rounded-full bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60"
          >
            {sending ? "Sending…" : "Send challenge"}
          </button>
          <button
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
