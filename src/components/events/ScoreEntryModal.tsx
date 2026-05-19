"use client";

import { useState } from "react";
import type { EventMatchView } from "./types";

type SetScore = { a: string; b: string };

export default function ScoreEntryModal({
  match,
  eventId,
  onClose,
  onSubmitted,
}: {
  match: EventMatchView;
  eventId: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [sets, setSets] = useState<SetScore[]>(parseInitial(match.score));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function setVal(idx: number, side: "a" | "b", value: string) {
    setSets((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [side]: value.replace(/[^0-9]/g, "") };
      return copy;
    });
  }
  function addSet() {
    if (sets.length >= 5) return;
    setSets((prev) => [...prev, { a: "", b: "" }]);
  }
  function removeSet(idx: number) {
    setSets((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit() {
    setError("");
    const payloadSets = sets
      .map((s) => `${s.a}-${s.b}`)
      .filter((s) => /^\d+-\d+$/.test(s));
    if (payloadSets.length === 0) {
      setError("Enter at least one set");
      return;
    }
    setSubmitting(true);
    const res = await fetch(
      `/api/events/${eventId}/matches/${match.id}/report`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score: payloadSets.join(",") }),
      }
    );
    setSubmitting(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error || "Couldn't submit score");
      return;
    }
    onSubmitted();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-2">
          <h2 className="font-display text-lg font-bold text-gray-900">Report score</h2>
          <p className="text-xs text-gray-500 mt-1">
            {match.player1?.name} <span className="text-gray-400">vs</span>{" "}
            {match.player2?.name}
          </p>
        </div>

        <div className="px-5 py-4 space-y-3">
          {sets.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-12">Set {i + 1}</span>
              <input
                type="text"
                inputMode="numeric"
                value={s.a}
                onChange={(e) => setVal(i, "a", e.target.value)}
                placeholder="6"
                className="w-14 px-2 py-1.5 border border-gray-200 rounded-lg text-center text-sm focus:outline-none focus:border-court-green"
              />
              <span className="text-gray-400">–</span>
              <input
                type="text"
                inputMode="numeric"
                value={s.b}
                onChange={(e) => setVal(i, "b", e.target.value)}
                placeholder="4"
                className="w-14 px-2 py-1.5 border border-gray-200 rounded-lg text-center text-sm focus:outline-none focus:border-court-green"
              />
              {sets.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeSet(i)}
                  className="text-xs text-gray-400 hover:text-red-600 ml-auto"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {sets.length < 5 && (
            <button
              type="button"
              onClick={addSet}
              className="text-xs text-court-green font-semibold hover:underline"
            >
              + Add a set
            </button>
          )}
        </div>

        {error && (
          <div className="mx-5 mb-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="px-5 pb-5 flex items-center gap-3">
          <button
            onClick={submit}
            disabled={submitting}
            className="flex-1 px-4 py-2 rounded-full bg-court-green text-white text-sm font-semibold hover:bg-court-green-light disabled:opacity-60"
          >
            {submitting ? "Submitting…" : "Submit"}
          </button>
          <button
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function parseInitial(score: string): SetScore[] {
  if (!score) return [{ a: "", b: "" }];
  const parts = score
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = p.match(/^(\d+)\s*[-:/]\s*(\d+)/);
      return m ? { a: m[1], b: m[2] } : { a: "", b: "" };
    });
  return parts.length > 0 ? parts : [{ a: "", b: "" }];
}
