"use client";

import { useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { guestJoinPost } from "@/lib/supabase/queries/guestRsvp";

/**
 * Guest RSVP for a public "Looking for players" post. Lets a non-member
 * respond by name (no account) via the guest_join_post anon RPC. Their
 * response lands in the host's "View Requests" list. On success we nudge
 * them toward a free account for the richer experience.
 *
 * The two auth CTAs (Sign up / Log in) live on the server page; this is the
 * third "no account needed" option, collapsed behind a toggle to keep the
 * primary CTAs prominent.
 */
export function GuestRsvpForm({
  postId,
  hostName,
  signupHref,
}: {
  postId: string;
  hostName: string;
  signupHref: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Please enter your name.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      await guestJoinPost(supabase, postId, trimmed, contact.trim() || undefined, note.trim() || undefined);
      setDone(true);
    } catch {
      setError("Couldn't send your RSVP. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="rounded-xl bg-court-green-pale/30 border border-court-green-pale p-4 text-center space-y-3">
        <p className="text-2xl">🎾</p>
        <p className="font-semibold text-court-green">
          You&apos;re on {hostName}&apos;s list!
        </p>
        <p className="text-sm text-gray-600">
          {hostName} will see your name and reach out with the details. Create a
          free account to see what&apos;s playing near you, join the group chat,
          and get match reminders.
        </p>
        <Link
          href={signupHref}
          className="block w-full text-center py-2.5 rounded-xl bg-court-green text-white font-semibold shadow-md hover:bg-court-green-soft transition-colors"
        >
          Create a free account
        </Link>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="block w-full text-center py-3 rounded-xl bg-white text-gray-700 font-semibold border border-gray-200 hover:bg-gray-50 transition-colors"
      >
        RSVP without an account
      </button>
    );
  }

  return (
    <div className="rounded-xl bg-white border border-court-green-pale p-4 space-y-3 text-left">
      <p className="text-sm font-semibold text-gray-900">RSVP as a guest</p>
      <div className="space-y-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          autoFocus
          maxLength={80}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-court-green focus:border-court-green"
        />
        <input
          type="text"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="Phone or email (optional)"
          maxLength={120}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-court-green focus:border-court-green"
        />
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a note (optional)"
          rows={2}
          maxLength={280}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-court-green focus:border-court-green"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="block w-full text-center py-2.5 rounded-xl bg-court-green text-white font-semibold shadow-md hover:bg-court-green-soft transition-colors disabled:opacity-60"
      >
        {submitting ? "Sending…" : "Send RSVP"}
      </button>
      <p className="text-[11px] text-center text-gray-400">
        No account needed. Create one later for the full experience.
      </p>
    </div>
  );
}
