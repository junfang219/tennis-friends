"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { listEventParticipants } from "@/lib/supabase/queries";
import { errorMessage } from "@/lib/errorMessage";

export default function LadderLineupControls({
  eventId,
  onSeeded,
}: {
  eventId: string;
  onSeeded?: () => void;
}) {
  const [seeded, setSeeded] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const parts = await listEventParticipants(supabase, eventId);
        if (!cancelled) {
          setSeeded(parts.some((p) => p.ladder_rank != null));
        }
      } catch {
        if (!cancelled) setSeeded(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  if (seeded !== false) return null;

  async function seed() {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: rpcErr } = await supabase.rpc(
        "seed_ladder_lineup",
        { p_event_id: eventId }
      );
      if (rpcErr) {
        setError(rpcErr.message || "Couldn't seed the ladder.");
        setBusy(false);
        return;
      }
      const seededCount = (data as { seeded?: number } | null)?.seeded ?? 0;
      setNotice(`Seeded ${seededCount} players by NTRP.`);
      setSeeded(true);
      onSeeded?.();
    } catch (err) {
      setError(errorMessage(err, "Couldn't seed the ladder."));
    }
    setBusy(false);
  }

  return (
    <div className="bg-indigo-50 rounded-2xl p-4 mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-indigo-800">
          Seed the lineup
        </p>
        <p className="text-xs text-gray-600 mt-0.5">
          Ranks every registered player from #1 down by NTRP rating
          (unrated players go to the bottom). One-shot — challenges
          decide movement from here.
        </p>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        {notice && !error && (
          <p className="text-xs text-green-700 mt-2">{notice}</p>
        )}
      </div>
      <button
        onClick={seed}
        disabled={busy}
        className="shrink-0 px-4 py-2 rounded-full bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60"
      >
        {busy ? "Seeding…" : "Seed lineup"}
      </button>
    </div>
  );
}
