"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { guestSetPollResponse, type GuestPoll } from "@/lib/supabase/queries";
import { validateBlock, type Block } from "@/lib/availabilityPoll";

function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if ([y, m, d].some((x) => Number.isNaN(x))) return date;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// HH:MM + minutes, capped at 23:45 so the end stays valid.
function addMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = Math.min((h || 0) * 60 + (m || 0) + mins, 23 * 60 + 45);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * A single open availability poll, rendered for a guest (no account). The guest
 * enters free-form time blocks per candidate date — the same model as the
 * in-app poll table — and saves via the anon guest_set_poll_response RPC.
 */
export default function GuestPollCard({ token, poll }: { token: string; poll: GuestPoll }) {
  const [byDate, setByDate] = useState<Record<string, Block[]>>(() => {
    const map: Record<string, Block[]> = {};
    for (const d of poll.candidate_dates) map[d] = [];
    for (const b of poll.my_blocks) {
      (map[b.date] ??= []).push({ date: b.date, start: b.start, end: b.end });
    }
    return map;
  });
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState("");

  const minHours = Math.round(poll.min_block_minutes / 60);

  const dirty = () => {
    setSave("idle");
    setErr("");
  };

  const addBlock = (date: string) => {
    setByDate((s) => ({
      ...s,
      [date]: [...(s[date] ?? []), { date, start: "18:00", end: addMinutes("18:00", poll.min_block_minutes) }],
    }));
    dirty();
  };

  const setBlock = (date: string, i: number, patch: Partial<Block>) => {
    setByDate((s) => ({
      ...s,
      [date]: (s[date] ?? []).map((b, idx) => (idx === i ? { ...b, ...patch } : b)),
    }));
    dirty();
  };

  const removeBlock = (date: string, i: number) => {
    setByDate((s) => ({ ...s, [date]: (s[date] ?? []).filter((_, idx) => idx !== i) }));
    dirty();
  };

  const onSave = async () => {
    const all = Object.values(byDate).flat();
    for (const b of all) {
      const v = validateBlock(b, poll.min_block_minutes);
      if (v) {
        setErr(v);
        setSave("error");
        return;
      }
    }
    setErr("");
    setSave("saving");
    try {
      const supabase = createSupabaseBrowserClient();
      await guestSetPollResponse(supabase, { token, pollId: poll.id, blocks: all });
      setSave("saved");
    } catch {
      setSave("error");
      setErr("Couldn't save — try again.");
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-4">
      <p className="font-semibold text-gray-900">{poll.title || "When can you play?"}</p>
      <p className="text-xs text-gray-500 mt-0.5">
        Add the times you&apos;re free — at least {minHours}h per block.
      </p>

      <div className="mt-3 space-y-3">
        {poll.candidate_dates.map((date) => (
          <div key={date}>
            <p className="text-xs font-bold text-gray-700">{formatDate(date)}</p>
            <div className="mt-1 space-y-1.5">
              {(byDate[date] ?? []).map((b, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    type="time"
                    step={900}
                    value={b.start}
                    onChange={(e) => setBlock(date, i, { start: e.target.value })}
                    className="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-court-green"
                  />
                  <span className="text-gray-400 text-sm">–</span>
                  <input
                    type="time"
                    step={900}
                    value={b.end}
                    onChange={(e) => setBlock(date, i, { end: e.target.value })}
                    className="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-court-green"
                  />
                  <button
                    onClick={() => removeBlock(date, i)}
                    aria-label="Remove time"
                    className="ml-1 text-gray-400 hover:text-red-500 text-lg leading-none"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                onClick={() => addBlock(date)}
                className="text-xs font-semibold text-court-green hover:underline"
              >
                + Add time
              </button>
            </div>
          </div>
        ))}
      </div>

      {err && <p className="mt-2 text-xs font-medium text-red-500">{err}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => void onSave()}
          disabled={save === "saving"}
          className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50"
        >
          {save === "saving" ? "Saving…" : "Save availability"}
        </button>
        {save === "saved" && (
          <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-court-green">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Saved
          </span>
        )}
      </div>
    </div>
  );
}
