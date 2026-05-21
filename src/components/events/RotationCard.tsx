"use client";

import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import type { EventMatchView } from "./types";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { listEventMatches } from "@/lib/supabase/queries";

export default function RotationCard({
  eventId,
  isOwner,
  onChanged,
}: {
  eventId: string;
  isOwner: boolean;
  onChanged?: () => void;
}) {
  const [matches, setMatches] = useState<EventMatchView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const rows = await listEventMatches(supabase, eventId);
        setMatches(
          rows.map((r) => ({
            id: r.id,
            eventId: r.event_id,
            player1Id: r.player1_id,
            player2Id: r.player2_id,
            player3Id: r.player3_id,
            player4Id: r.player4_id,
            round: r.round,
            bracketSlot: r.bracket_slot,
            scheduledAt: r.scheduled_at,
            courtAssign: r.court_assign,
            score: r.score,
            winnerSide: r.winner_side,
            status: r.status,
          })) as unknown as EventMatchView[]
        );
      } catch {
        setMatches([]);
      }
      setLoading(false);
    })();
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function postNext() {
    setError("");
    setPosting(true);
    // Rotation generation (round-robin pairing avoiding repeats, BYE
    // handling) requires a non-trivial server-side algorithm. Reinstate
    // as an Edge Function before launch.
    setError("Rotation pairing requires the events-rotation Edge Function (deferred). Talk to the dev.");
    setPosting(false);
    void onChanged;
  }

  if (loading) return <div className="text-sm text-gray-500 py-6 text-center">Loading rotations…</div>;

  const rounds = new Map<number, EventMatchView[]>();
  for (const m of matches ?? []) {
    const r = m.round ?? 0;
    if (!rounds.has(r)) rounds.set(r, []);
    rounds.get(r)!.push(m);
  }
  const sortedRounds = [...rounds.entries()].sort(([a], [b]) => b - a);

  return (
    <div className="space-y-4">
      {isOwner && (
        <div className="bg-ball-yellow/20 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-court-green">
              Pair next round
            </p>
            <p className="text-xs text-gray-600">
              Pairings draw from checked-in players first.
            </p>
          </div>
          <button
            onClick={postNext}
            disabled={posting}
            className="px-4 py-2 rounded-full bg-court-green text-white text-sm font-semibold hover:bg-court-green-light disabled:opacity-60"
          >
            {posting ? "Posting…" : "Post round"}
          </button>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {sortedRounds.length === 0 ? (
        <div className="bg-white rounded-2xl p-5 shadow-sm text-center text-sm text-gray-500">
          No rounds yet.
        </div>
      ) : (
        sortedRounds.map(([round, ms]) => (
          <section key={round} className="bg-white rounded-2xl p-4 shadow-sm">
            <h4 className="text-sm font-bold text-gray-900 mb-2">
              Round {round}
            </h4>
            <ul className="space-y-2">
              {ms.map((m, i) => (
                <li key={m.id} className="flex items-center gap-2 text-sm">
                  <span className="text-xs text-gray-400 w-14">Court {i + 1}</span>
                  <PlayerPill player={m.player1} />
                  <span className="text-xs text-gray-400 font-bold">vs</span>
                  <PlayerPill player={m.player2} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function PlayerPill({ player }: { player: EventMatchView["player1"] }) {
  if (!player) return <span className="text-gray-400 italic">TBD</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar name={player.name} image={player.profileImageUrl} size="sm" />
      <span className="text-gray-800 truncate">{player.name}</span>
    </span>
  );
}
