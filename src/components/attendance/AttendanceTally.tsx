"use client";

import { RSVP, type RsvpStatus } from "@/lib/rsvpStatus";

type Row = { status: string };

// Symbols carry the meaning (color alone is invisible to colorblind users and
// the hover tooltip doesn't exist on touch): ✓ playing, ? maybe, ✗ not playing.
// Exported so legends can show the same symbols next to the words.
export const RSVP_SYMBOL: Partial<Record<RsvpStatus, string>> = {
  playing: "✓",
  maybe: "?",
  not_playing: "✗",
};

const STYLE: Record<RsvpStatus, { dot: string; label: string; bg: string }> = {
  playing: { dot: "✓", label: "text-court-green", bg: "bg-court-green/15" },
  maybe: { dot: "?", label: "text-ball-yellow-dark", bg: "bg-ball-yellow/30" },
  not_playing: { dot: "✗", label: "text-gray-500", bg: "bg-gray-100" },
  no_response: { dot: "•", label: "text-gray-400", bg: "bg-gray-50" },
};

/**
 * One-line attendance tally — three small count badges (playing / maybe /
 * not playing). Intended for tight contexts like match column headers
 * where the full AttendanceList would be too heavy.
 */
export default function AttendanceTally({ availabilities }: { availabilities: Row[] }) {
  const counts: Record<RsvpStatus, number> = {
    playing: 0,
    maybe: 0,
    not_playing: 0,
    no_response: 0,
  };
  for (const a of availabilities) {
    const s = (a.status as RsvpStatus) in counts ? (a.status as RsvpStatus) : RSVP.NO_RESPONSE;
    counts[s] += 1;
  }
  const visible: RsvpStatus[] = [RSVP.PLAYING, RSVP.MAYBE, RSVP.NOT_PLAYING];
  if (visible.every((s) => counts[s] === 0)) return null;
  return (
    <div className="flex items-center gap-1 mt-1">
      {visible.map((s) => {
        if (counts[s] === 0) return null;
        const meta = STYLE[s];
        return (
          <span
            key={s}
            className={`inline-flex items-center gap-0.5 ${meta.bg} ${meta.label} text-[10px] font-bold px-1.5 py-0.5 rounded`}
            title={`${counts[s]} ${s.replace("_", " ")}`}
            aria-label={`${counts[s]} ${s.replace("_", " ")}`}
          >
            <span aria-hidden>{meta.dot}</span>
            {counts[s]}
          </span>
        );
      })}
    </div>
  );
}
