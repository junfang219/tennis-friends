"use client";

import { useState } from "react";

export type PollOption = {
  id: string;
  text: string;
  order: number;
  voteCount: number;
};

export type PollData = {
  id: string;
  question: string;
  isMulti: boolean;
  isClosed: boolean;
  createdById: string;
  options: PollOption[];
  myOptionIds: string[];
  totalVotes: number;
};

export type PollCardProps = {
  poll: PollData;
  myUserId: string;
  canClose: boolean;
  onVoteChange: (pollId: string, optionIds: string[]) => Promise<void>;
  onToggleClose: (pollId: string, isClosed: boolean) => Promise<void>;
};

/**
 * Renders an inline poll card inside the team chat. Optimistic — flips
 * the local selection on click and lets the parent reconcile counts via
 * the next message poll.
 */
export default function PollCard({ poll, myUserId, canClose, onVoteChange, onToggleClose }: PollCardProps) {
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(poll.myOptionIds));
  const hasVoted = selected.size > 0;
  const totalSelectable = poll.options.reduce((sum, o) => sum + o.voteCount, 0) || 1;

  const handleClick = async (optionId: string) => {
    if (poll.isClosed || pending) return;
    const next = new Set(selected);
    if (poll.isMulti) {
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
    } else {
      next.clear();
      next.add(optionId);
    }
    setSelected(next);
    setPending(true);
    try {
      await onVoteChange(poll.id, Array.from(next));
    } finally {
      setPending(false);
    }
  };

  const handleClear = async () => {
    if (poll.isClosed || pending) return;
    setSelected(new Set());
    setPending(true);
    try {
      await onVoteChange(poll.id, []);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 max-w-sm">
      <div className="flex items-start justify-between gap-2 mb-3">
        <p className="text-sm font-semibold text-gray-900 leading-snug">{poll.question}</p>
        {poll.isClosed && (
          <span className="text-[9px] font-bold tracking-wider text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded uppercase shrink-0">
            Closed
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        {poll.options.map((opt) => {
          const mine = selected.has(opt.id);
          const pct = poll.totalVotes > 0 ? Math.round((opt.voteCount / totalSelectable) * 100) : 0;
          return (
            <button
              key={opt.id}
              onClick={() => handleClick(opt.id)}
              disabled={poll.isClosed || pending}
              className={`relative w-full text-left rounded-lg border overflow-hidden transition-colors ${
                mine
                  ? "border-court-green bg-court-green/5"
                  : "border-gray-200 hover:border-court-green-soft"
              } ${poll.isClosed ? "cursor-default" : ""}`}
            >
              {/* Vote bar fill */}
              <span
                className={`absolute inset-y-0 left-0 ${mine ? "bg-court-green/15" : "bg-gray-100"}`}
                style={{ width: `${pct}%` }}
                aria-hidden
              />
              <span className="relative flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`w-3.5 h-3.5 rounded-full border ${mine ? "border-court-green bg-court-green" : "border-gray-300"} shrink-0 flex items-center justify-center`}>
                    {mine && (
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </span>
                  <span className="truncate text-gray-800">{opt.text}</span>
                </span>
                <span className="text-[11px] text-gray-500 font-semibold tabular-nums shrink-0">
                  {opt.voteCount} · {pct}%
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px] text-gray-500">
        <span>
          {poll.totalVotes} {poll.totalVotes === 1 ? "vote" : "votes"}
          {poll.isMulti && " · multi-select"}
        </span>
        <div className="flex items-center gap-2">
          {hasVoted && !poll.isClosed && (
            <button onClick={handleClear} disabled={pending} className="text-court-green-soft hover:text-court-green font-semibold">
              Clear
            </button>
          )}
          {canClose && (
            <button
              onClick={() => onToggleClose(poll.id, !poll.isClosed)}
              className="text-court-green-soft hover:text-court-green font-semibold"
            >
              {poll.isClosed ? "Reopen" : "Close poll"}
            </button>
          )}
        </div>
      </div>
      {/* myUserId reserved for future per-user UI states (e.g. inline avatars). */}
      <span hidden>{myUserId}</span>
    </div>
  );
}
