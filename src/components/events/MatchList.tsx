"use client";

import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import type { EventMatchView, PlayerMini } from "./types";
import ScoreEntryModal from "./ScoreEntryModal";

export default function MatchList({
  eventId,
  currentUserId,
  onChanged,
}: {
  eventId: string;
  currentUserId: string | null;
  onChanged?: () => void;
}) {
  const [matches, setMatches] = useState<EventMatchView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportMatch, setReportMatch] = useState<EventMatchView | null>(null);
  const [actionInFlight, setActionInFlight] = useState(false);
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

  async function confirm(match: EventMatchView) {
    setActionInFlight(true);
    setError("");
    const res = await fetch(
      `/api/events/${eventId}/matches/${match.id}/confirm`,
      { method: "POST" }
    );
    setActionInFlight(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error || "Couldn't confirm.");
      return;
    }
    load();
    onChanged?.();
  }

  async function dispute(match: EventMatchView) {
    if (!confirmDialog("Dispute this score? The match will reset for re-entry."))
      return;
    setActionInFlight(true);
    setError("");
    const res = await fetch(
      `/api/events/${eventId}/matches/${match.id}/dispute`,
      { method: "POST" }
    );
    setActionInFlight(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error || "Couldn't dispute.");
      return;
    }
    load();
    onChanged?.();
  }

  if (loading) {
    return <div className="text-sm text-gray-500 py-6 text-center">Loading matches…</div>;
  }
  if (!matches || matches.length === 0) {
    return (
      <div className="text-sm text-gray-500 py-6 text-center">
        No matches yet.
      </div>
    );
  }

  const buckets = {
    pending: matches.filter((m) => m.status === "in_progress"),
    scheduled: matches.filter(
      (m) => m.status === "scheduled" || m.status === "proposed"
    ),
    completed: matches.filter((m) => m.status === "completed"),
  };

  return (
    <div className="space-y-5">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {buckets.pending.length > 0 && (
        <Section title="Awaiting confirmation">
          {buckets.pending.map((m) => (
            <MatchRow
              key={m.id}
              match={m}
              currentUserId={currentUserId}
              actionInFlight={actionInFlight}
              onReport={() => setReportMatch(m)}
              onConfirm={() => confirm(m)}
              onDispute={() => dispute(m)}
            />
          ))}
        </Section>
      )}

      {buckets.scheduled.length > 0 && (
        <Section title="Upcoming">
          {buckets.scheduled.map((m) => (
            <MatchRow
              key={m.id}
              match={m}
              currentUserId={currentUserId}
              actionInFlight={actionInFlight}
              onReport={() => setReportMatch(m)}
              onConfirm={() => confirm(m)}
              onDispute={() => dispute(m)}
            />
          ))}
        </Section>
      )}

      {buckets.completed.length > 0 && (
        <Section title="Completed">
          {buckets.completed.map((m) => (
            <MatchRow
              key={m.id}
              match={m}
              currentUserId={currentUserId}
              actionInFlight={actionInFlight}
              onReport={() => setReportMatch(m)}
              onConfirm={() => confirm(m)}
              onDispute={() => dispute(m)}
            />
          ))}
        </Section>
      )}

      {reportMatch && (
        <ScoreEntryModal
          match={reportMatch}
          eventId={eventId}
          onClose={() => setReportMatch(null)}
          onSubmitted={() => {
            setReportMatch(null);
            load();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
        {title}
      </h4>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

function MatchRow({
  match,
  currentUserId,
  actionInFlight,
  onReport,
  onConfirm,
  onDispute,
}: {
  match: EventMatchView;
  currentUserId: string | null;
  actionInFlight: boolean;
  onReport: () => void;
  onConfirm: () => void;
  onDispute: () => void;
}) {
  const isPlayer =
    currentUserId != null &&
    (currentUserId === match.player1Id || currentUserId === match.player2Id);
  const canReport = isPlayer && (match.status === "scheduled" || match.status === "in_progress");
  const canConfirm =
    isPlayer && match.status === "in_progress" && currentUserId !== match.reportedBy;
  const canDispute = canConfirm;

  return (
    <li className="bg-white rounded-xl px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2">
        <PlayerChip player={match.player1} highlight={match.winnerSide === 1} />
        <span className="text-xs text-gray-400 font-bold px-1">vs</span>
        <PlayerChip player={match.player2} highlight={match.winnerSide === 2} />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-gray-500">
          {match.bracketSlot && <span className="mr-2">{match.bracketSlot}</span>}
          {match.round != null && !match.bracketSlot && (
            <span className="mr-2">Round {match.round}</span>
          )}
          {match.score && <span className="font-semibold text-gray-700">{match.score}</span>}
          {match.status === "in_progress" && (
            <span className="ml-2 text-amber-600">awaiting confirm</span>
          )}
          {match.status === "proposed" && (
            <span className="ml-2 text-indigo-600">challenge pending</span>
          )}
          {match.status === "declined" && (
            <span className="ml-2 text-gray-400">declined</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canConfirm && (
            <button
              onClick={onConfirm}
              disabled={actionInFlight}
              className="px-3 py-1 rounded-full bg-court-green text-white text-xs font-semibold hover:bg-court-green-light disabled:opacity-60"
            >
              Confirm
            </button>
          )}
          {canDispute && (
            <button
              onClick={onDispute}
              disabled={actionInFlight}
              className="px-3 py-1 rounded-full bg-white border border-red-200 text-red-700 text-xs font-semibold hover:bg-red-50 disabled:opacity-60"
            >
              Dispute
            </button>
          )}
          {canReport && !canConfirm && (
            <button
              onClick={onReport}
              disabled={actionInFlight}
              className="px-3 py-1 rounded-full bg-ball-yellow/80 text-court-green text-xs font-semibold hover:bg-ball-yellow disabled:opacity-60"
            >
              {match.status === "in_progress" ? "Re-report" : "Report score"}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function PlayerChip({
  player,
  highlight,
}: {
  player: PlayerMini | null;
  highlight: boolean;
}) {
  if (!player) {
    return <span className="text-sm text-gray-400 italic">TBD</span>;
  }
  return (
    <span className={`inline-flex items-center gap-2 ${highlight ? "font-semibold" : ""}`}>
      <Avatar name={player.name} image={player.profileImageUrl} size="sm" />
      <span className="text-sm text-gray-800 truncate">{player.name}</span>
      {highlight && <span className="text-green-600 text-xs">✓</span>}
    </span>
  );
}

function confirmDialog(msg: string): boolean {
  if (typeof window === "undefined") return false;
  return window.confirm(msg);
}
