"use client";

import { useState } from "react";
import type { RankedWindow } from "@/lib/availabilityPoll";

interface Props {
  windows: RankedWindow[];
  onPick: (w: RankedWindow) => void;
  emptyLabel: string;
  pickLabel?: string;
  tone?: "primary" | "muted";
}

function formatDateLong(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function RankedWindowList({
  windows,
  onPick,
  emptyLabel,
  pickLabel = "Schedule this match",
  tone = "primary",
}: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (windows.length === 0) {
    return <div className="text-sm text-gray-400 py-4 text-center">{emptyLabel}</div>;
  }
  return (
    <ul className="space-y-2">
      {windows.map((w) => {
        const key = `${w.date}|${w.start}`;
        const open = expanded === key;
        return (
          <li
            key={key}
            className={`border rounded-xl p-3 ${
              tone === "muted" ? "border-gray-200 bg-gray-50" : "border-gray-200 bg-white"
            }`}
          >
            <button
              type="button"
              onClick={() => setExpanded(open ? null : key)}
              className="w-full text-left flex items-center justify-between gap-2"
            >
              <div className="flex flex-col">
                <div className="font-semibold text-gray-900">
                  {formatDateLong(w.date)} · {w.start}–{w.end}
                </div>
                <div className="text-xs text-gray-500">
                  {formatDuration(w.durationMinutes)} ·{" "}
                  <span className={tone === "muted" ? "text-gray-500" : "text-court-green font-semibold"}>
                    {w.memberIds.length} {w.memberIds.length === 1 ? "player" : "players"}
                  </span>
                </div>
              </div>
              <span className="text-gray-400 text-sm">{open ? "▾" : "▸"}</span>
            </button>
            {open && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {w.memberNames.map((name) => (
                    <span
                      key={name}
                      className="text-xs px-2 py-0.5 rounded-full bg-court-green-pale/30 text-court-green-dark"
                    >
                      {name}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => onPick(w)}
                  className="w-full bg-court-green text-white rounded-lg py-2 text-sm font-semibold hover:bg-court-green-light"
                >
                  {pickLabel}
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
