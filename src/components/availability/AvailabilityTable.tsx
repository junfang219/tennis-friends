"use client";

import { useMemo } from "react";
import Avatar from "@/components/Avatar";
import type { Block } from "@/lib/availabilityPoll";
import { validateBlock } from "@/lib/availabilityPoll";
import type { PollResponse } from "@/lib/supabase/queries/availabilityPolls";

interface MemberLite {
  id: string;
  name: string;
  profileImageUrl: string;
}

interface Props {
  candidateDates: string[];
  responses: PollResponse[];
  members: MemberLite[];
  myUserId: string;
  myBlocks: Map<string, Block[]>;
  minBlockMinutes: number;
  disabled?: boolean;
  onAdd: (date: string) => void;
  onChange: (date: string, index: number, patch: Partial<Block>) => void;
  onRemove: (date: string, index: number) => void;
}

function formatDateLong(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTimeLocale(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  // toLocaleTimeString respects the device locale, so the read-only display
  // matches whatever format the native <input type="time"> widget uses for
  // this user (US → "9:00 AM", UK → "09:00").
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatBlock(b: Block): string {
  return `${formatTimeLocale(b.start)}–${formatTimeLocale(b.end)}`;
}

// Unified per-date table. The "You" row sits first in every date, with
// editable time-input pairs and an Add-block affordance. Other members
// follow, sorted alphabetically by name, with their blocks rendered as
// read-only text. RLS already lets every member read every response —
// this is purely a display merge of the previous BlockEditor + grid.
export function AvailabilityTable({
  candidateDates,
  responses,
  members,
  myUserId,
  myBlocks,
  minBlockMinutes,
  disabled,
  onAdd,
  onChange,
  onRemove,
}: Props) {
  const memberById = useMemo(() => {
    const map = new Map<string, MemberLite>();
    for (const m of members) map.set(m.id, m);
    return map;
  }, [members]);

  const me = memberById.get(myUserId);

  // Per-date: list of OTHER members (not me) who have at least one block
  // on this date, sorted alphabetically. Blocks within a member sorted
  // by start time.
  const othersByDate = useMemo(() => {
    const out = new Map<string, Array<{ member: MemberLite; blocks: Block[] }>>();
    for (const date of candidateDates) {
      const rows: Array<{ member: MemberLite; blocks: Block[] }> = [];
      for (const r of responses) {
        // `members` and `myUserId` are now keyed by group_members.id (member_id),
        // so responses join on member_id — this keeps account-less placeholders
        // distinct and tolerates a null user_id.
        if (r.member_id === myUserId) continue;
        const blocks = (r.blocks ?? []).filter((b) => b.date === date);
        if (blocks.length === 0) continue;
        const member = memberById.get(r.member_id);
        if (!member) continue;
        const sorted = [...blocks].sort((a, b) => a.start.localeCompare(b.start));
        rows.push({ member, blocks: sorted });
      }
      rows.sort((a, b) => a.member.name.localeCompare(b.member.name));
      out.set(date, rows);
    }
    return out;
  }, [candidateDates, responses, myUserId, memberById]);

  return (
    <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
      {candidateDates.map((date) => {
        const myDateBlocks = myBlocks.get(date) ?? [];
        const others = othersByDate.get(date) ?? [];
        return (
          <div key={date} className="p-4">
            <h3 className="text-xs uppercase tracking-wider font-bold text-gray-400 mb-3">
              {formatDateLong(date)}
            </h3>

            {/* You row */}
            <div className="flex items-start gap-3">
              {me ? (
                <Avatar image={me.profileImageUrl} name={me.name} size="sm" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-gray-200" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-900 mb-1.5">You</div>
                {myDateBlocks.length === 0 && disabled && (
                  <div className="text-xs text-gray-400">No blocks set</div>
                )}
                {myDateBlocks.map((b, i) => {
                  const err = validateBlock(b, minBlockMinutes);
                  return (
                    <div key={i} className="flex items-center gap-2 mb-1.5">
                      <input
                        type="time"
                        value={b.start}
                        lang="en-GB"
                        step={900}
                        disabled={disabled}
                        onChange={(e) => onChange(date, i, { start: e.target.value })}
                        className="border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-court-green disabled:bg-gray-50"
                      />
                      <span className="text-gray-400 text-sm">→</span>
                      <input
                        type="time"
                        value={b.end}
                        lang="en-GB"
                        step={900}
                        disabled={disabled}
                        onChange={(e) => onChange(date, i, { end: e.target.value })}
                        className="border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-court-green disabled:bg-gray-50"
                      />
                      {!disabled && (
                        <button
                          type="button"
                          onClick={() => onRemove(date, i)}
                          className="text-gray-400 hover:text-red-500 p-1 rounded"
                          aria-label="Remove block"
                        >
                          ×
                        </button>
                      )}
                      {err && (
                        <span className="text-xs text-red-500 ml-1">{err}</span>
                      )}
                    </div>
                  );
                })}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => onAdd(date)}
                    className="text-sm font-semibold text-court-green hover:text-court-green-light"
                  >
                    + Add block
                  </button>
                )}
              </div>
            </div>

            {/* Other members */}
            {others.length > 0 && (
              <ul className="mt-3 space-y-2 pl-0">
                {others.map(({ member, blocks }) => (
                  <li key={member.id} className="flex items-start gap-3">
                    <Avatar image={member.profileImageUrl} name={member.name} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-900">{member.name}</div>
                      <div className="text-xs text-gray-500">
                        {blocks.map(formatBlock).join(", ")}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
