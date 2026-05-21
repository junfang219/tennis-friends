"use client";

import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import type { BracketView as BracketViewT } from "./types";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { listEventMatches, type EventMatchRow } from "@/lib/supabase/queries";

// Group event_matches by round into the shape BracketViewT expects.
function groupByRound(rows: EventMatchRow[]): BracketViewT["rounds"] {
  const byRound = new Map<number, EventMatchRow[]>();
  for (const r of rows) {
    const round = r.round ?? 0;
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round)!.push(r);
  }
  return Array.from(byRound.entries())
    .sort(([a], [b]) => a - b)
    .map(([round, matches]) => ({
      round,
      label: round === 0 ? "Round 1" : `Round ${round + 1}`,
      matches: matches.map((m) => ({
        id: m.id,
        player1Id: m.player1_id,
        player2Id: m.player2_id,
        score: m.score,
        winnerSide: m.winner_side,
        status: m.status,
      })),
    })) as unknown as BracketViewT["rounds"];
}

export default function BracketView({
  eventId,
  isOwner,
  onSeeded,
}: {
  eventId: string;
  isOwner: boolean;
  onSeeded?: () => void;
}) {
  const [data, setData] = useState<BracketViewT | null>(null);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const rows = await listEventMatches(supabase, eventId);
        const seeded = rows.length > 0;
        setData(
          seeded
            ? ({
                seeded: true,
                rounds: groupByRound(rows),
              } as unknown as BracketViewT)
            : ({ seeded: false } as unknown as BracketViewT)
        );
      } catch {
        setData(null);
      }
      setLoading(false);
    })();
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function seed() {
    if (!confirm("Seed the bracket from current registrations? Signups will lock."))
      return;
    setSeeding(true);
    setError("");
    // Bracket seeding is a non-trivial algorithm (random pairing,
    // optional ELO seeding, BYEs for odd counts). Reinstate as a Supabase
    // Edge Function before launch — keeping the button disabled until then.
    setError("Bracket seeding requires the events-bracket Edge Function (deferred). Talk to the dev.");
    setSeeding(false);
    void onSeeded;
  }

  if (loading) return <div className="text-sm text-gray-500 py-6 text-center">Loading bracket…</div>;
  if (!data || !data.seeded) {
    return (
      <div className="bg-white rounded-2xl p-5 shadow-sm text-center">
        <p className="text-sm text-gray-500 mb-3">No bracket yet.</p>
        {isOwner && (
          <>
            <button
              onClick={seed}
              disabled={seeding}
              className="px-4 py-2 rounded-full bg-court-green text-white text-sm font-semibold hover:bg-court-green-light disabled:opacity-60"
            >
              {seeding ? "Seeding…" : "Seed bracket"}
            </button>
            {error && (
              <p className="mt-3 text-xs text-red-600">{error}</p>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl p-3 shadow-sm overflow-x-auto">
      <div className="flex gap-3 min-w-fit">
        {data.rounds.map((round) => (
          <div key={round.round} className="flex-shrink-0 w-44">
            <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2 px-1">
              {round.label}
            </h4>
            <div className="space-y-3">
              {round.matches.map((m) => (
                <div
                  key={m.id}
                  className="bg-gray-50 rounded-lg p-2.5 border border-gray-100"
                >
                  <Slot
                    name={m.player1?.name ?? null}
                    image={m.player1?.profileImageUrl}
                    winner={m.winnerSide === 1}
                    eliminated={m.winnerSide === 2}
                  />
                  <div className="border-t border-gray-200 my-1.5" />
                  <Slot
                    name={m.player2?.name ?? null}
                    image={m.player2?.profileImageUrl}
                    winner={m.winnerSide === 2}
                    eliminated={m.winnerSide === 1}
                  />
                  {m.score && (
                    <div className="mt-1.5 text-[10px] text-gray-500 text-center">
                      {m.score}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Slot({
  name,
  image,
  winner,
  eliminated,
}: {
  name: string | null;
  image: string | undefined;
  winner: boolean;
  eliminated: boolean;
}) {
  if (!name) {
    return <div className="text-xs text-gray-400 italic h-6 flex items-center">TBD</div>;
  }
  return (
    <div
      className={`flex items-center gap-2 ${winner ? "font-semibold text-court-green" : eliminated ? "text-gray-400 line-through" : "text-gray-800"}`}
    >
      <Avatar name={name} image={image} size="sm" />
      <span className="text-xs truncate flex-1">{name}</span>
      {winner && <span className="text-xs">✓</span>}
    </div>
  );
}
