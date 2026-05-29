"use client";

import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import type { EventMatchView, PlayerMini } from "./types";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  listEventMatches,
  listEventParticipants,
} from "@/lib/supabase/queries";
import { mixerPairings } from "@/lib/eventCompetitive";
import { errorMessage } from "@/lib/errorMessage";

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
  const [notice, setNotice] = useState("");

  const load = () => {
    setLoading(true);
    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const [rows, parts] = await Promise.all([
          listEventMatches(supabase, eventId),
          listEventParticipants(supabase, eventId),
        ]);
        // Build a profile lookup so each round renders real names/avatars
        // instead of falling through to "TBD" (RotationCard previously
        // never joined profile data — see also MatchList.tsx).
        const playerById = new Map<string, PlayerMini>(
          parts.map((p) => [
            p.user_id,
            {
              id: p.user.id,
              name: p.user.name,
              profileImageUrl: p.user.profile_image_url,
              ntrpRating: p.user.ntrp_rating,
            },
          ])
        );
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
            reportedBy: r.reported_by ?? "",
            confirmedBy: r.confirmed_by ?? "",
            proposedBy: r.proposed_by ?? "",
            disputedAt: r.disputed_at,
            status: r.status,
            player1: playerById.get(r.player1_id) ?? null,
            player2: playerById.get(r.player2_id) ?? null,
            player3: r.player3_id ? playerById.get(r.player3_id) ?? null : null,
            player4: r.player4_id ? playerById.get(r.player4_id) ?? null : null,
          })) as EventMatchView[]
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
    setNotice("");
    setPosting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const parts = await listEventParticipants(supabase, eventId);
      const registered = parts.filter((p) => p.status === "registered");
      const checkedIn = registered.filter((p) => p.checked_in_at != null);
      // Prefer checked-in players; if no one has checked in, pair from
      // the registered pool so a small mixer doesn't stall behind the
      // check-in flow.
      const pool = checkedIn.length > 0 ? checkedIn : registered;
      if (pool.length < 2) {
        setError("Need at least 2 signed-up players to pair a round.");
        setPosting(false);
        return;
      }

      const existingRounds = (matches ?? [])
        .map((m) => m.round ?? 0)
        .filter((n) => n > 0);
      const nextRound =
        existingRounds.length === 0 ? 1 : Math.max(...existingRounds) + 1;

      const { pairs, bye } = mixerPairings(
        pool.map((p) => p.user_id),
        eventId,
        nextRound
      );
      if (pairs.length === 0) {
        setError("Not enough players to form a pair.");
        setPosting(false);
        return;
      }

      const { error: rpcErr } = await supabase.rpc(
        "post_event_rotation_round",
        {
          p_event_id: eventId,
          p_round: nextRound,
          p_pairs: pairs as unknown as never,
          ...(bye ? { p_bye: bye } : {}),
        }
      );
      if (rpcErr) {
        setError(rpcErr.message || "Couldn't post the round.");
        setPosting(false);
        return;
      }

      const byeName = bye
        ? parts.find((p) => p.user_id === bye)?.user.name ?? null
        : null;
      setNotice(
        byeName
          ? `Posted round ${nextRound}. ${byeName} sits out this round.`
          : `Posted round ${nextRound}.`
      );
      load();
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err, "Couldn't post the round."));
    }
    setPosting(false);
  }

  if (loading)
    return (
      <div className="text-sm text-gray-500 py-6 text-center">
        Loading rotations…
      </div>
    );

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
      {notice && !error && (
        <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-xl px-4 py-3">
          {notice}
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
                  <span className="text-xs text-gray-400 w-14">
                    {m.courtAssign || `Court ${i + 1}`}
                  </span>
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
