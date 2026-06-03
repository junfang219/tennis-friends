"use client";

import { useMemo, useState } from "react";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

interface Props {
  selected: string[];               // sorted YYYY-MM-DD strings
  onToggle: (date: string) => void;
  maxDates?: number;
}

// Month-grid date picker that supports multi-selecting an arbitrary set
// of future dates. Past dates render disabled. Layout mirrors the team
// calendar page so the picker feels native to the app.
export function MonthMultiPicker({ selected, onToggle, maxDates = 60 }: Props) {
  const today = useMemo(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate());
  }, []);
  const [cursor, setCursor] = useState<Date>(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const cells = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startWeekday = firstDay.getDay();
    const out: ({ day: number; date: string } | null)[] = [];
    for (let i = 0; i < startWeekday; i++) out.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month, day);
      out.push({ day, date: dateKey(d) });
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [cursor]);

  const todayKey = dateKey(today);

  const isPast = (key: string) => key < todayKey;
  const atCap = selected.length >= maxDates;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3">
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          className="w-9 h-9 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-500"
          aria-label="Previous month"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="15,18 9,12 15,6" />
          </svg>
        </button>
        <h3 className="font-display text-base font-bold text-gray-900">
          {MONTH_LABELS[cursor.getMonth()]} {cursor.getFullYear()}
        </h3>
        <button
          type="button"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          className="w-9 h-9 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-500"
          aria-label="Next month"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="9,18 15,12 9,6" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="text-[10px] uppercase tracking-wider font-bold text-gray-400 text-center py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, i) => {
          if (!cell) return <div key={`pad-${i}`} className="aspect-square" />;
          const past = isPast(cell.date);
          const chosen = selectedSet.has(cell.date);
          const disabled = past || (atCap && !chosen);
          return (
            <button
              key={cell.date}
              type="button"
              onClick={() => onToggle(cell.date)}
              disabled={disabled}
              className={`aspect-square min-h-[40px] rounded-lg text-sm font-semibold transition-colors ${
                chosen
                  ? "bg-court-green text-white"
                  : past
                  ? "text-gray-300 cursor-not-allowed"
                  : disabled
                  ? "text-gray-400 cursor-not-allowed bg-gray-50"
                  : "bg-gray-50 hover:bg-court-green-pale/30 text-gray-700"
              } ${cell.date === todayKey && !chosen ? "ring-2 ring-court-green/40" : ""}`}
              aria-pressed={chosen}
            >
              {cell.day}
            </button>
          );
        })}
      </div>

      <div className="mt-3 text-xs text-gray-500">
        {selected.length} {selected.length === 1 ? "date" : "dates"} selected
        {atCap ? " (max reached)" : ""}
      </div>
    </div>
  );
}
