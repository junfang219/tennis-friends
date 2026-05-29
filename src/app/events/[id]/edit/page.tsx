"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EVENT_TYPE_META } from "@/lib/eventTypeMeta";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getEvent } from "@/lib/supabase/queries";
import { toEventCamel } from "@/lib/supabase/adapters";
import { errorMessage } from "@/lib/errorMessage";

const VALID_STATUSES = ["open", "closed", "active", "completed", "cancelled"] as const;

export default function EditEventPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  const [eventType, setEventType] = useState("round_robin");
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
  const [isPublicSignup, setIsPublicSignup] = useState(true);
  const [status, setStatus] = useState<(typeof VALID_STATUSES)[number]>("open");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    getEvent(supabase, String(params.id))
      .then((row) => {
        if (!row) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        const data = toEventCamel(row);
        setEventType(data.eventType);
        setTitle(data.title);
        setDescription(data.description || "");
        setStartDate(toLocalInput(data.startDate));
        setEndDate(toLocalInput(data.endDate));
        setSignupDeadline(data.signupDeadline ? toLocalInput(data.signupDeadline) : "");
        setVenueName(data.venueName || "");
        setVenueAddress(data.venueAddress || "");
        setMaxParticipants(data.maxParticipants != null ? String(data.maxParticipants) : "");
        setNtrpMin(data.ntrpMin != null ? String(data.ntrpMin) : "");
        setNtrpMax(data.ntrpMax != null ? String(data.ntrpMax) : "");
        setIsPublicSignup(data.isPublicSignup);
        setStatus(data.status as typeof status);
        setLoading(false);
      })
      .catch(() => {
        setForbidden(true);
        setLoading(false);
      });
  }, [params.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!title.trim()) {
      setError("Title can't be empty.");
      return;
    }
    if (!startDate || !endDate) {
      setError("Start and end dates are required.");
      return;
    }
    setSubmitting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: upErr } = await supabase
        .from("events")
        .update({
          title: title.trim(),
          description: description.trim(),
          start_date: new Date(startDate).toISOString(),
          end_date: new Date(endDate).toISOString(),
          signup_deadline: signupDeadline ? new Date(signupDeadline).toISOString() : null,
          venue_name: venueName.trim(),
          venue_address: venueAddress.trim(),
          max_participants: maxParticipants ? Number(maxParticipants) : null,
          ntrp_min: ntrpMin ? Number(ntrpMin) : null,
          ntrp_max: ntrpMax ? Number(ntrpMax) : null,
          is_public_signup: isPublicSignup,
          status,
        })
        .eq("id", String(params.id));
      if (upErr) {
        setError(upErr.message || "Couldn't save changes. Try again.");
        setSubmitting(false);
        return;
      }
      router.push(`/events/${params.id}`);
    } catch (err) {
      setError(errorMessage(err, "Network error. Try again."));
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!confirm("Cancel this event? Participants will see it marked Cancelled.")) return;
    setSubmitting(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: upErr } = await supabase
        .from("events")
        .update({ status: "cancelled" })
        .eq("id", String(params.id));
      if (upErr) {
        setError(upErr.message || "Couldn't cancel the event.");
        setSubmitting(false);
        return;
      }
      router.push(`/events/${params.id}`);
    } catch (err) {
      setError(errorMessage(err, "Network error. Try again."));
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="skeleton w-1/3 h-6 mb-3" />
        <div className="skeleton w-full h-40 rounded-2xl" />
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <h2 className="text-xl font-semibold text-gray-700 mb-2">Event not found</h2>
        <button onClick={() => router.push("/events")} className="text-court-green hover:underline">
          Back to events
        </button>
      </div>
    );
  }
  if (forbidden) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <h2 className="text-xl font-semibold text-gray-700 mb-2">You can&apos;t edit this event</h2>
        <p className="text-sm text-gray-500 mb-4">Only the organizer can edit.</p>
        <button onClick={() => router.push(`/events/${params.id}`)} className="text-court-green hover:underline">
          Back to event
        </button>
      </div>
    );
  }

  const typeMeta = EVENT_TYPE_META[eventType] ?? EVENT_TYPE_META.mixer;
  const inputCls =
    "block w-full min-w-0 max-w-full appearance-none bg-white px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-court-green/30 focus:border-court-green text-sm";

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
      <h1 className="font-display text-2xl font-bold text-court-green mb-1">Edit event</h1>
      <p className="text-gray-500 text-sm mb-6">
        Changes are visible to anyone with the event link. Capacity bumps auto-promote the waitlist.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <section className="bg-gray-50 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-white flex items-center justify-center text-xl shadow-sm">
            {typeMeta.emoji}
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
              Event type
            </div>
            <div className="font-semibold text-sm text-gray-900">{typeMeta.label}</div>
            <div className="text-[11px] text-gray-500">
              Type can&apos;t be changed after creation.
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
          <Field label="Title">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputCls}
              required
            />
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={`${inputCls} resize-none`}
            />
          </Field>
        </section>

        <section className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Start">
              <input
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={inputCls}
                required
              />
            </Field>
            <Field label="End">
              <input
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={inputCls}
                required
              />
            </Field>
          </div>
          <Field label="Signup deadline (optional)">
            <input
              type="datetime-local"
              value={signupDeadline}
              onChange={(e) => setSignupDeadline(e.target.value)}
              className={inputCls}
            />
          </Field>
        </section>

        <section className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
          <Field label="Venue name">
            <input
              value={venueName}
              onChange={(e) => setVenueName(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Venue address">
            <input
              value={venueAddress}
              onChange={(e) => setVenueAddress(e.target.value)}
              className={inputCls}
            />
          </Field>
        </section>

        <section className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
          <Field
            label="Max participants"
            hint="Raise the cap to auto-promote the waitlist. Lowering blocks new signups but won't remove existing players."
          >
            <input
              type="number"
              min="2"
              value={maxParticipants}
              onChange={(e) => setMaxParticipants(e.target.value)}
              placeholder="Leave blank for no cap"
              className={inputCls}
            />
          </Field>
          <Field label="NTRP range" hint="Applies to new signups only.">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="7"
                step="0.5"
                value={ntrpMin}
                onChange={(e) => setNtrpMin(e.target.value)}
                placeholder="Min"
                className={inputCls}
              />
              <span className="text-gray-400">to</span>
              <input
                type="number"
                min="1"
                max="7"
                step="0.5"
                value={ntrpMax}
                onChange={(e) => setNtrpMax(e.target.value)}
                placeholder="Max"
                className={inputCls}
              />
            </div>
          </Field>
          <Field label="Visibility">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={isPublicSignup}
                onChange={(e) => setIsPublicSignup(e.target.checked)}
                className="w-4 h-4 accent-court-green"
              />
              <span>Public signup — anyone with the link can sign up</span>
            </label>
          </Field>
          <Field label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as (typeof VALID_STATUSES)[number])}
              className={inputCls}
            >
              <option value="open">Open</option>
              <option value="closed">Closed (no new signups)</option>
              <option value="active">Active (in progress)</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </Field>
        </section>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={() => router.push(`/events/${params.id}`)}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
          {status !== "cancelled" && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={submitting}
              className="ml-auto text-sm text-red-600 hover:underline"
            >
              Cancel this event
            </button>
          )}
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

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
