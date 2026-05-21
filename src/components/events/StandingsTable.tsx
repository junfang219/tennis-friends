"use client";

import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import type { StandingsRowView } from "./types";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { listEventParticipants } from "@/lib/supabase/queries";

export default function StandingsTable({
  eventId,
  currentUserId,
}: {
  eventId: string;
  currentUserId: string | null;
}) {
  const [rows, setRows] = useState<StandingsRowView[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const parts = await listEventParticipants(supabase, eventId);
        // Sort by points desc, then wins desc, then set differential.
        const sorted = [...parts].sort((a, b) => {
          if (b.points !== a.points) return b.points - a.points;
          if (b.wins !== a.wins) return b.wins - a.wins;
          return b.sets_won - b.sets_lost - (a.sets_won - a.sets_lost);
        });
        setRows(
          sorted.map((p, i) => ({
            rank: i + 1,
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
  }, [eventId]);

  if (loading) {
    return <div className="text-sm text-gray-500 py-6 text-center">Loading standings…</div>;
  }
  if (!rows || rows.length === 0) {
    return (
      <div className="text-sm text-gray-500 py-6 text-center">No standings yet.</div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr className="text-xs uppercase tracking-wide text-gray-500">
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">Player</th>
            <th className="px-2 py-2 text-right">W–L</th>
            <th className="px-2 py-2 text-right">Sets</th>
            <th className="px-2 py-2 text-right">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isMe = currentUserId === row.userId;
            return (
              <tr
                key={row.userId}
                className={`border-t border-gray-100 ${isMe ? "bg-court-green/5" : ""}`}
              >
                <td className="px-3 py-2 font-semibold text-gray-700">{row.rank}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {row.user && (
                      <Avatar
                        name={row.user.name}
                        image={row.user.profileImageUrl}
                        size="sm"
                      />
                    )}
                    <span className="text-gray-800">{row.user?.name ?? "—"}</span>
                  </div>
                </td>
                <td className="px-2 py-2 text-right text-gray-700">
                  {row.wins}–{row.losses}
                </td>
                <td className="px-2 py-2 text-right text-gray-500">
                  {row.setsWon}–{row.setsLost}
                </td>
                <td className="px-2 py-2 text-right font-semibold text-court-green">
                  {row.points}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
