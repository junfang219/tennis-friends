"use client";

import { useState } from "react";

// A focused composer for posting a "I want to play within this event" note.
// Writes to the same /api/posts endpoint as the main composer but with the
// event context attached so the post surfaces inside the event chat + feed.
export default function FindPartnerComposer({
  eventId,
  eventTitle,
  defaultSkillMin,
  defaultSkillMax,
  onClose,
  onPosted,
}: {
  eventId: string;
  eventTitle: string;
  defaultSkillMin?: number | null;
  defaultSkillMax?: number | null;
  onClose: () => void;
  onPosted: () => void;
}) {
  const [content, setContent] = useState("");
  const [playDate, setPlayDate] = useState("");
  const [playTime, setPlayTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!content.trim()) {
      setError("Add a quick note about what you're looking for.");
      return;
    }
    setSubmitting(true);
    setError("");
    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: content.trim(),
        postType: "match-seek",
        eventId,
        playDate: playDate || "",
        playTime: playTime || "",
        gameType: "singles",
        skillMin: defaultSkillMin ?? null,
        skillMax: defaultSkillMax ?? null,
        playersNeeded: 1,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      setError(d?.error || "Couldn't post. Try again.");
      return;
    }
    onPosted();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-bold text-gray-900">
          Find a match partner
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          Posts to the {eventTitle} chat and the discover feed.
        </p>

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Looking for a quick singles set Sat morning, NTRP 4.0+, can travel…"
          rows={4}
          className="mt-3 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-court-green resize-none"
        />

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs font-semibold text-gray-500">Day</span>
            <input
              type="date"
              value={playDate}
              onChange={(e) => setPlayDate(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-court-green"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-500">Time</span>
            <input
              type="time"
              value={playTime}
              onChange={(e) => setPlayTime(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-court-green"
            />
          </label>
        </div>

        {(defaultSkillMin != null || defaultSkillMax != null) && (
          <p className="mt-2 text-[11px] text-gray-500">
            Skill range will use the event&apos;s NTRP {defaultSkillMin ?? "?"}–
            {defaultSkillMax ?? "?"} by default.
          </p>
        )}

        {error && (
          <div className="mt-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={submit}
            disabled={submitting}
            className="flex-1 px-4 py-2 rounded-full bg-court-green text-white text-sm font-semibold hover:bg-court-green-light disabled:opacity-60"
          >
            {submitting ? "Posting…" : "Post"}
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
