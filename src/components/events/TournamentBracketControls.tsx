"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  listEventMatches,
  listEventParticipants,
} from "@/lib/supabase/queries";
import { orderForTournamentSeed, seedBracket } from "@/lib/eventCompetitive";
import { errorMessage } from "@/lib/errorMessage";

export default function TournamentBracketControls({
  eventId,
  onSeeded,
}: {
  eventId: string;
  onSeeded?: () => void;
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

  // Hide until we know the state, then hide forever once the bracket is in.
  if (hasMatches !== false) return null;

  async function generate() {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const parts = await listEventParticipants(supabase, eventId);
      const registered = parts.filter((p) => p.status === "registered");
      if (registered.length < 2) {
        setError("Need at least 2 registered players to seed a bracket.");
        setBusy(false);
        return;
      }
      const ordered = orderForTournamentSeed(registered);
      const pairs = seedBracket(ordered.map((p) => p.user_id));
      const { error: rpcErr } = await supabase.rpc("seed_event_bracket", {
        p_event_id: eventId,
        p_pairs: pairs as unknown as never,
      });
      if (rpcErr) {
        setError(rpcErr.message || "Couldn't generate the bracket.");
        setBusy(false);
        return;
      }
      setNotice(`Bracket seeded — ${registered.length} players.`);
      setHasMatches(true);
      onSeeded?.();
    } catch (err) {
      setError(errorMessage(err, "Couldn't generate the bracket."));
    }
    setBusy(false);
  }

  return (
    <div className="bg-clay/10 rounded-2xl p-4 mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-clay">Generate tournament bracket</p>
        <p className="text-xs text-gray-600 mt-0.5">
          Seeds by NTRP — highest-rated player gets the top seed, lowest
          gets the bottom. Byes go to the top seeds when the field
          isn&apos;t a power of two. Signups lock once seeded.
        </p>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        {notice && !error && (
          <p className="text-xs text-green-700 mt-2">{notice}</p>
        )}
      </div>
      <button
        onClick={generate}
        disabled={busy}
        className="shrink-0 px-4 py-2 rounded-full bg-clay text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "Generating…" : "Generate"}
      </button>
    </div>
  );
}
