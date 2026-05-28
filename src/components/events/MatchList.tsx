"use client";

import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import type { EventMatchView, PlayerMini } from "./types";
import ScoreEntryModal from "./ScoreEntryModal";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { listEventMatches } from "@/lib/supabase/queries";
import { errorMessage } from "@/lib/errorMessage";

export default function MatchList({
  eventId,
  currentUserId,
  focusMatchId,
  onChanged,
}: {
  eventId: string;
  currentUserId: string | null;
  focusMatchId?: string | null;
  onChanged?: () => void;
}) {
  const [matches, setMatches] = useState<EventMatchView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportMatch, setReportMatch] = useState<EventMatchView | null>(null);
  const [actionInFlight, setActionInFlight] = useState(false);
  const [error, setError] = useState("");
  const focusedRowRef = useRef<HTMLLIElement | null>(null);

  // Scroll the focused row into view once the matches have loaded.
  useEffect(() => {
    if (!focusMatchId || !matches) return;
    const node = focusedRowRef.current;
    if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusMatchId, matches]);

  const load = () => {
    setLoading(true);
    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const rows = await listEventMatches(supabase, eventId);
        // Adapt to the page's EventMatchView shape (camelCase + display
        // helpers). PlayerMini info isn't joined here yet — the page
        // gracefully renders unknown player IDs.
        const adapted = rows.map((r) => ({
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
          reportedBy: r.reported_by,
          confirmedBy: r.confirmed_by,
          proposedBy: r.proposed_by,
          status: r.status,
        })) as unknown as EventMatchView[];
        setMatches(adapted);
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

  async function confirm(match: EventMatchView) {
    setActionInFlight(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Not signed in");
      // "Confirm" = sign off on the reported score. Mark this user as
      // confirmed_by and set status=completed when both players have signed off.
      // Simplified: any confirm flips status to 'completed'.
      const { error: upErr } = await supabase
        .from("event_matches")
        .update({
          confirmed_by: auth.user.id,
          status: "completed",
        })
        .eq("id", match.id);
      if (upErr) throw upErr;
      load();
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err, "Couldn't confirm."));
    }
    setActionInFlight(false);
  }

  async function respondToChallenge(match: EventMatchView, accept: boolean) {
    setActionInFlight(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      // Notifications + chat msg fan out via the
      // notify_on_event_match_status_change trigger (proposed -> {scheduled,declined}).
      const { error: upErr } = await supabase
        .from("event_matches")
        .update({ status: accept ? "scheduled" : "declined" })
        .eq("id", match.id);
      if (upErr) throw upErr;
      load();
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err, "Couldn't respond to the challenge."));
    }
    setActionInFlight(false);
  }

  async function dispute(match: EventMatchView) {
    if (!confirmDialog("Dispute this score? The match will reset for re-entry."))
      return;
    setActionInFlight(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: upErr } = await supabase
        .from("event_matches")
        .update({
          score: "",
          winner_side: null,
          reported_by: null,
          confirmed_by: null,
          disputed_at: new Date().toISOString(),
          status: "scheduled",
        })
        .eq("id", match.id);
      if (upErr) throw upErr;
      load();
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err, "Couldn't dispute."));
    }
    setActionInFlight(false);
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
              focused={m.id === focusMatchId}
              focusedRef={m.id === focusMatchId ? focusedRowRef : null}
              onReport={() => setReportMatch(m)}
              onConfirm={() => confirm(m)}
              onDispute={() => dispute(m)}
              onRespond={(accept) => respondToChallenge(m, accept)}
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
              focused={m.id === focusMatchId}
              focusedRef={m.id === focusMatchId ? focusedRowRef : null}
              onReport={() => setReportMatch(m)}
              onConfirm={() => confirm(m)}
              onDispute={() => dispute(m)}
              onRespond={(accept) => respondToChallenge(m, accept)}
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
              focused={m.id === focusMatchId}
              focusedRef={m.id === focusMatchId ? focusedRowRef : null}
              onReport={() => setReportMatch(m)}
              onConfirm={() => confirm(m)}
              onDispute={() => dispute(m)}
              onRespond={(accept) => respondToChallenge(m, accept)}
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
  focused,
  focusedRef,
  onReport,
  onConfirm,
  onDispute,
  onRespond,
}: {
  match: EventMatchView;
  currentUserId: string | null;
  actionInFlight: boolean;
  focused?: boolean;
  focusedRef?: React.RefObject<HTMLLIElement | null> | null;
  onReport: () => void;
  onConfirm: () => void;
  onDispute: () => void;
  onRespond: (accept: boolean) => void;
}) {
  const isPlayer =
    currentUserId != null &&
    (currentUserId === match.player1Id || currentUserId === match.player2Id);
  const canReport = isPlayer && (match.status === "scheduled" || match.status === "in_progress");
  const canConfirm =
    isPlayer && match.status === "in_progress" && currentUserId !== match.reportedBy;
  const canDispute = canConfirm;
  // Only the challenged player (player2) can accept / decline a
  // proposed challenge — the propose_ladder_challenge RPC puts the
  // challenger at player1 and the opponent at player2.
  const canRespond =
    match.status === "proposed" &&
    currentUserId != null &&
    currentUserId === match.player2Id;

  return (
    <li
      ref={focusedRef ?? undefined}
      className={`bg-white rounded-xl px-4 py-3 shadow-sm transition-all ${focused ? "ring-2 ring-court-green shadow-md" : ""}`}
    >
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
          {canRespond && (
            <>
              <button
                onClick={() => onRespond(true)}
                disabled={actionInFlight}
                className="px-3 py-1 rounded-full bg-court-green text-white text-xs font-semibold hover:bg-court-green-light disabled:opacity-60"
              >
                Accept
              </button>
              <button
                onClick={() => onRespond(false)}
                disabled={actionInFlight}
                className="px-3 py-1 rounded-full bg-white border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-50 disabled:opacity-60"
              >
                Decline
              </button>
            </>
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
