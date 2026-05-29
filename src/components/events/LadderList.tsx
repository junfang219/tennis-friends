"use client";

import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import type { StandingsRowView } from "./types";
import ChallengeModal from "./ChallengeModal";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { listEventParticipants } from "@/lib/supabase/queries";

const DEFAULT_MAX_GAP = 3;

export default function LadderList({
  eventId,
  currentUserId,
  maxGap = DEFAULT_MAX_GAP,
}: {
  eventId: string;
  currentUserId: string | null;
  maxGap?: number;
}) {
  const [rows, setRows] = useState<StandingsRowView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [challengeTarget, setChallengeTarget] = useState<StandingsRowView | null>(null);

  const load = () => {
    setLoading(true);
    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const parts = await listEventParticipants(supabase, eventId);
        // Once the ladder is seeded, ladder_rank is the source of
        // truth (swapped by handle_ladder_match_completion on match
        // wins). Falls back to points-based ordering for un-seeded
        // ladders so this view keeps working the way it did before.
        const isSeeded = parts.some((p) => p.ladder_rank != null);
        const sorted = isSeeded
          ? [...parts].sort(
              (a, b) =>
                (a.ladder_rank ?? Number.MAX_SAFE_INTEGER) -
                (b.ladder_rank ?? Number.MAX_SAFE_INTEGER)
            )
          : [...parts].sort((a, b) => b.points - a.points);
        setRows(
          sorted.map((p, i) => ({
            rank: p.ladder_rank ?? i + 1,
            userId: p.user_id,
            user: {
              id: p.user.id,
              name: p.user.name,
              profileImageUrl: p.user.profile_image_url,
            },
            wins: p.wins,
            losses: p.losses,
            setsWon: p.sets_won,
            setsLost: p.sets_lost,
            points: p.points,
          })) as unknown as StandingsRowView[]
        );
      } catch {
        setRows([]);
      }
      setLoading(false);
    })();
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  if (loading) return <div className="text-sm text-gray-500 py-6 text-center">Loading ladder…</div>;
  if (!rows || rows.length === 0) {
    return <div className="text-sm text-gray-500 py-6 text-center">No ladder yet.</div>;
  }

  const myRank = currentUserId
    ? rows.find((r) => r.userId === currentUserId)?.rank ?? null
    : null;

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <ul>
        {rows.map((row) => {
          const isMe = currentUserId === row.userId;
          const canChallenge =
            !isMe &&
            myRank != null &&
            row.rank < myRank &&
            myRank - row.rank <= maxGap;
          return (
            <li
              key={row.userId}
              className={`flex items-center gap-3 px-4 py-3 border-b border-gray-100 last:border-b-0 ${isMe ? "bg-indigo-50/30" : ""}`}
            >
              <span className="text-sm font-bold w-6 text-indigo-700">
                #{row.rank}
              </span>
              {row.user && (
                <Avatar name={row.user.name} image={row.user.profileImageUrl} size="sm" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">
                  {row.user?.name ?? "—"}
                  {isMe && <span className="ml-2 text-[10px] text-indigo-600">you</span>}
                </div>
                <div className="text-xs text-gray-500">
                  {row.wins}–{row.losses} · {row.points} pts
                </div>
              </div>
              {canChallenge && (
                <button
                  onClick={() => setChallengeTarget(row)}
                  className="px-3 py-1 rounded-full bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700"
                >
                  Challenge
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {challengeTarget && (
        <ChallengeModal
          eventId={eventId}
          opponent={challengeTarget}
          onClose={() => setChallengeTarget(null)}
          onSent={() => {
            setChallengeTarget(null);
            load();
          }}
        />
      )}
    </div>
  );
}
