"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const TYPES = [
  { id: "tournament", label: "Tournament", emoji: "🏆", blurb: "Single-elimination bracket. Organizer seeds pairings." },
  { id: "round_robin", label: "Round Robin", emoji: "🔁", blurb: "Everyone plays everyone. Standings auto-update." },
  { id: "mixer", label: "Social Mixer", emoji: "🤝", blurb: "Partners rotate each round. Casual play." },
  { id: "clinic", label: "Clinic", emoji: "🎾", blurb: "Drop-in lesson or practice. No matches required." },
] as const;

type TypeId = (typeof TYPES)[number]["id"];

export default function NewEventPage() {
  const router = useRouter();
  const [type, setType] = useState<TypeId>("round_robin");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [signupDeadline, setSignupDeadline] = useState("");
  const [venueName, setVenueName] = useState("");
  const [venueAddress, setVenueAddress] = useState("");
  const [maxParticipants, setMaxParticipants] = useState("");
  const [ntrpMin, setNtrpMin] = useState("");
  const [ntrpMax, setNtrpMax] = useState("");
  const [postToFeed, setPostToFeed] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!title.trim()) {
      setError("Give your event a title.");
      return;
    }
    if (!startDate || !endDate) {
      setError("Pick a start and end date.");
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        title: title.trim(),
        description: description.trim(),
        eventType: type,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
        signupDeadline: signupDeadline ? new Date(signupDeadline).toISOString() : null,
        venueName: venueName.trim(),
        venueAddress: venueAddress.trim(),
        maxParticipants: maxParticipants ? Number(maxParticipants) : null,
        ntrpMin: ntrpMin ? Number(ntrpMin) : null,
        ntrpMax: ntrpMax ? Number(ntrpMax) : null,
        postToFeed,
      };
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Couldn't create the event. Try again.");
        setSubmitting(false);
        return;
      }
      const event = await res.json();
      router.push(`/events/${event.id}`);
    } catch {
      setError("Network error. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <button
        onClick={() => router.back()}
        className="text-sm text-gray-500 hover:text-gray-700 mb-3 inline-flex items-center gap-1"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <polyline points="15,18 9,12 15,6" />
        </svg>
        Back
      </button>
      <h1 className="font-display text-2xl font-bold text-court-green mb-1">
        Create an event
      </h1>
      <p className="text-gray-500 text-sm mb-6">Pick a type, then fill in the details.</p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <section className="bg-white rounded-2xl p-5 shadow-sm">
          <label className="block text-sm font-semibold text-gray-700 mb-3">Event type</label>
          <div className="grid grid-cols-2 gap-2">
            {TYPES.map((t) => {
              const selected = type === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setType(t.id)}
                  className={`text-left p-3 rounded-xl border-2 transition-all ${
                    selected
                      ? "border-court-green bg-court-green/5"
                      : "border-gray-200 hover:border-gray-300 bg-white"
                  }`}
                >
                  <div className="text-xl mb-1">{t.emoji}</div>
                  <div className="font-semibold text-sm text-gray-900">{t.label}</div>
                  <div className="text-[11px] text-gray-500 leading-snug mt-0.5">{t.blurb}</div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
          <Field label="Title">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Summer 3.5 round-robin"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-court-green/30 focus:border-court-green text-sm"
              required
            />
          </Field>
          <Field label="Description (optional)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's the format? What should players bring?"
              rows={3}
              className="form-input resize-none"
            />
          </Field>
        </section>

        <section className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start">
              <input
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-court-green/30 focus:border-court-green text-sm"
                required
              />
            </Field>
            <Field label="End">
              <input
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-court-green/30 focus:border-court-green text-sm"
                required
              />
            </Field>
          </div>
          <Field label="Signup deadline (optional)">
            <input
              type="datetime-local"
              value={signupDeadline}
              onChange={(e) => setSignupDeadline(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-court-green/30 focus:border-court-green text-sm"
            />
          </Field>
        </section>

        <section className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
          <Field label="Venue name (optional)">
            <input
              value={venueName}
              onChange={(e) => setVenueName(e.target.value)}
              placeholder="Amy Yee Tennis Center"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-court-green/30 focus:border-court-green text-sm"
            />
          </Field>
          <Field label="Venue address (optional)">
            <input
              value={venueAddress}
              onChange={(e) => setVenueAddress(e.target.value)}
              placeholder="2000 Martin Luther King Jr Way S"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-court-green/30 focus:border-court-green text-sm"
            />
          </Field>
        </section>

        <section className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
          <Field label="Max participants (optional)" hint="Leave blank for no cap. Beyond this, signups go to a waitlist.">
            <input
              type="number"
              min="2"
              value={maxParticipants}
              onChange={(e) => setMaxParticipants(e.target.value)}
              placeholder="e.g. 16"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-court-green/30 focus:border-court-green text-sm"
            />
          </Field>
          <Field label="NTRP range (optional)" hint="Restrict signup to a skill range.">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="7"
                step="0.5"
                value={ntrpMin}
                onChange={(e) => setNtrpMin(e.target.value)}
                placeholder="3.0"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-court-green/30 focus:border-court-green text-sm"
              />
              <span className="text-gray-400">to</span>
              <input
                type="number"
                min="1"
                max="7"
                step="0.5"
                value={ntrpMax}
                onChange={(e) => setNtrpMax(e.target.value)}
                placeholder="4.0"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-court-green/30 focus:border-court-green text-sm"
              />
            </div>
          </Field>
        </section>

        <section className="bg-white rounded-2xl p-5 shadow-sm">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={postToFeed}
              onChange={(e) => setPostToFeed(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded accent-court-green"
            />
            <span className="flex-1">
              <span className="block text-sm font-semibold text-gray-700">
                Post to feed for discovery
              </span>
              <span className="block text-[12px] text-gray-500 mt-0.5">
                Other players see your event in their feed and can sign up. Uncheck if you only
                plan to invite specific friends.
              </span>
            </span>
          </label>
        </section>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? "Creating…" : "Create event"}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold text-gray-700 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-gray-500 mt-1">{hint}</span>}
    </label>
  );
}
