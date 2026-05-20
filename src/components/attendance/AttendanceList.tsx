"use client";

import Avatar from "@/components/Avatar";
import { RSVP, RSVP_LABEL, type RsvpStatus } from "@/lib/rsvpStatus";

export type AttendanceRow = {
  userId: string;
  user: { id: string; name: string; profileImageUrl: string };
  status: string;
};

export type AttendanceListProps = {
  // All RSVP rows that have been recorded for this event.
  rows: AttendanceRow[];
  // Optional: the full team roster. When provided, members without a row are
  // surfaced in the "No response" bucket. Without it, no-response is hidden.
  rosterUserIds?: string[];
  rosterById?: Record<string, { id: string; name: string; profileImageUrl: string }>;
  // Optional compact mode — single line per bucket with names inline.
  compact?: boolean;
};

const BUCKET_ORDER: RsvpStatus[] = [RSVP.PLAYING, RSVP.MAYBE, RSVP.NOT_PLAYING, RSVP.NO_RESPONSE];

const BUCKET_STYLE: Record<RsvpStatus, { dot: string; label: string }> = {
  playing: { dot: "bg-court-green", label: "text-court-green" },
  maybe: { dot: "bg-ball-yellow", label: "text-ball-yellow-dark" },
  not_playing: { dot: "bg-gray-400", label: "text-gray-500" },
  no_response: { dot: "bg-gray-200", label: "text-gray-400" },
};

/**
 * Live "who's playing" panel. Buckets RSVP rows by status using the unified
 * playing/maybe/not_playing/no_response vocab. Inspired by Team Cowboy's
 * Attendance List widget.
 */
export default function AttendanceList({ rows, rosterUserIds, rosterById, compact }: AttendanceListProps) {
  // Bucket rows by canonical status. Unknown values fold into no_response.
  const buckets: Record<RsvpStatus, AttendanceRow[]> = {
    playing: [],
    maybe: [],
    not_playing: [],
    no_response: [],
  };
  const seen = new Set<string>();
  for (const r of rows) {
    seen.add(r.userId);
    const status = (r.status as RsvpStatus) in buckets ? (r.status as RsvpStatus) : RSVP.NO_RESPONSE;
    buckets[status].push(r);
  }

  // Synthesize no_response rows from the roster (members who never RSVP'd).
  if (rosterUserIds && rosterById) {
    for (const uid of rosterUserIds) {
      if (seen.has(uid)) continue;
      const u = rosterById[uid];
      if (!u) continue;
      buckets[RSVP.NO_RESPONSE].push({ userId: uid, user: u, status: RSVP.NO_RESPONSE });
    }
  }

  return (
    <div className={compact ? "space-y-1.5" : "space-y-3"}>
      {BUCKET_ORDER.map((status) => {
        const list = buckets[status];
        if (list.length === 0) return null;
        const style = BUCKET_STYLE[status];
        return (
          <div key={status} className={compact ? "flex items-baseline gap-2" : ""}>
            <div className={`flex items-center gap-1.5 ${compact ? "shrink-0" : "mb-1.5"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
              <span className={`text-[11px] font-bold uppercase tracking-wider ${style.label}`}>
                {RSVP_LABEL[status]} ({list.length})
              </span>
            </div>
            {compact ? (
              <p className="text-xs text-gray-600 truncate">
                {list.map((r) => r.user.name).join(", ")}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {list.map((r) => (
                  <span
                    key={r.userId}
                    className="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-0.5 bg-gray-50 rounded-full text-xs text-gray-700"
                    title={r.user.name}
                  >
                    <Avatar name={r.user.name} image={r.user.profileImageUrl} size="sm" />
                    <span className="truncate max-w-[8rem]">{r.user.name}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
