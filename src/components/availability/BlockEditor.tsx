"use client";

import { useMemo } from "react";
import type { Block } from "@/lib/availabilityPoll";
import { validateBlock } from "@/lib/availabilityPoll";

interface Props {
  date: string;          // YYYY-MM-DD
  blocks: Block[];       // only blocks for this date
  minBlockMinutes: number;
  onAdd: () => void;
  onChange: (index: number, patch: Partial<Block>) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}

function formatDateLong(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// Per-date block list. Each block is a (start, end) time pair with inline
// validation. The "Add block" button appends another (start, end) pair so
// members can record disjoint windows on the same date (e.g., morning AND
// evening).
export function BlockEditor({
  date,
  blocks,
  minBlockMinutes,
  onAdd,
  onChange,
  onRemove,
  disabled,
}: Props) {
  const errors = useMemo(
    () => blocks.map((b) => validateBlock(b, minBlockMinutes)),
    [blocks, minBlockMinutes],
  );

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3">
      <div className="font-semibold text-gray-900 mb-2">{formatDateLong(date)}</div>
      {blocks.length === 0 && (
        <div className="text-sm text-gray-400 mb-2">No blocks yet</div>
      )}
      <div className="space-y-2">
        {blocks.map((b, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="time"
              value={b.start}
              lang="en-GB"
              step={900}
              disabled={disabled}
              onChange={(e) => onChange(i, { start: e.target.value })}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-court-green disabled:bg-gray-50"
            />
            <span className="text-gray-400 text-sm">→</span>
            <input
              type="time"
              value={b.end}
              lang="en-GB"
              step={900}
              disabled={disabled}
              onChange={(e) => onChange(i, { end: e.target.value })}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-court-green disabled:bg-gray-50"
            />
            <button
              type="button"
              onClick={() => onRemove(i)}
              disabled={disabled}
              className="ml-auto text-gray-400 hover:text-red-500 disabled:hover:text-gray-400 p-1 rounded"
              aria-label="Remove block"
            >
              ×
            </button>
            {errors[i] && (
              <span className="text-xs text-red-500 ml-1">{errors[i]}</span>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        className="mt-2 text-sm font-semibold text-court-green hover:text-court-green-light disabled:opacity-50"
      >
        + Add block
      </button>
    </div>
  );
}
