"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  listEventMatches,
  listEventParticipants,
} from "@/lib/supabase/queries";
import { roundRobinSinglesSchedule } from "@/lib/eventCompetitive";
import { errorMessage } from "@/lib/errorMessage";

export default function RoundRobinScheduleControls({
  eventId,
  onGenerated,
}: {
  eventId: string;
  onGenerated?: () => void;
}) {
  const [hasMatches, setHasMatches] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const rows = await listEventMatches(supabase, eventId);
        if (!cancelled) setHasMatches(rows.length > 0);
      } catch {
        if (!cancelled) setHasMatches(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  // Hide until we know the state, then hide forever once the schedule is in.
  if (hasMatches !== false) return null;

  async function generate() {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const parts = await listEventParticipants(supabase, eventId);
      const registered = parts.filter((p) => p.status === "registered");
      const checkedIn = registered.filter((p) => p.checked_in_at != null);
      // Prefer checked-in players so no-shows don't pad the schedule;
      // fall back to all registered if check-in hasn't started yet.
      const pool = checkedIn.length > 0 ? checkedIn : registered;
      if (pool.length < 2) {
        setError("Need at least 2 players to generate a schedule.");
        setBusy(false);
        return;
      }

      const { rounds } = roundRobinSinglesSchedule(pool.map((p) => p.user_id));
      if (rounds.length === 0) {
        setError("Couldn't build a schedule from the current roster.");
        setBusy(false);
        return;
      }

      const { error: rpcErr } = await supabase.rpc(
        "generate_round_robin_schedule",
        {
          p_event_id: eventId,
          p_schedule: rounds as unknown as never,
        }
      );
      if (rpcErr) {
        setError(rpcErr.message || "Couldn't generate the schedule.");
        setBusy(false);
        return;
      }

      const totalMatches = rounds.reduce((sum, r) => sum + r.pairs.length, 0);
      setNotice(
        `Schedule posted — ${rounds.length} rounds, ${totalMatches} matches.`
      );
      setHasMatches(true);
      onGenerated?.();
    } catch (err) {
      setError(errorMessage(err, "Couldn't generate the schedule."));
    }
    setBusy(false);
  }

  return (
    <div className="bg-ball-yellow/20 rounded-2xl p-4 mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-court-green">
          Generate round-robin schedule
        </p>
        <p className="text-xs text-gray-600 mt-0.5">
          Builds every round at once so each checked-in player faces every
          other exactly once. Can&apos;t be regenerated after — make sure
          everyone&apos;s checked in first.
        </p>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        {notice && !error && (
          <p className="text-xs text-green-700 mt-2">{notice}</p>
        )}
      </div>
      <button
        onClick={generate}
        disabled={busy}
        className="shrink-0 px-4 py-2 rounded-full bg-court-green text-white text-sm font-semibold hover:bg-court-green-light disabled:opacity-60"
      >
        {busy ? "Generating…" : "Generate"}
      </button>
    </div>
  );
}
