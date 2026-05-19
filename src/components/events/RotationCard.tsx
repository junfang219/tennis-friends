"use client";

import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import type { EventMatchView } from "./types";

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
    fetch(`/api/events/${eventId}/matches`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        setMatches(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function postNext() {
    setError("");
    setPosting(true);
    const res = await fetch(`/api/events/${eventId}/rotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setPosting(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      setError(d?.error || "Couldn't post round");
      return;
    }
    load();
    onChanged?.();
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
