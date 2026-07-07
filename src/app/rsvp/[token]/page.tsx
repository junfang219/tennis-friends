"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  getGuestRosterView,
  guestSetAvailability,
  guestUpdateName,
  guestPollView,
  type GuestRosterView,
  type GuestEvent,
  type GuestPoll,
} from "@/lib/supabase/queries";
import GuestPollCard from "@/components/rsvp/GuestPollCard";
import { errorMessage } from "@/lib/errorMessage";
import { RSVP, normalizeMatchStatus, normalizePracticeStatus, type RsvpStatus } from "@/lib/rsvpStatus";
import RsvpPicker from "@/components/attendance/RsvpPicker";
import Avatar from "@/components/Avatar";
import CalendarExportButtons from "@/components/calendar/CalendarExportButtons";
import { type ExportEvent } from "@/lib/calendarExport";

export default function GuestRsvpPage() {
  const params = useParams();
  const token = params.token as string;

  const [view, setView] = useState<GuestRosterView | null>(null);
  const [polls, setPolls] = useState<GuestPoll[]>([]);
  // Who (if anyone) is signed in on this device — so a real account can claim the
  // placeholder instead of only RSVPing anonymously. null = anonymous viewer.
  const [viewer, setViewer] = useState<{ name: string } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [hasRsvped, setHasRsvped] = useState(false);
  // Per-event save indicator so a guest can SEE each answer persist.
  const [saveState, setSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const evKey = (ev: GuestEvent) => `${ev.event_kind}-${ev.id}`;

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const [data, pollData] = await Promise.all([
        getGuestRosterView(supabase, token),
        guestPollView(supabase, token).catch(() => [] as GuestPoll[]),
      ]);
      setView(data);
      setPolls(pollData);
      setNameDraft(data.member.name);
    } catch (err) {
      setLoadError(
        errorMessage(
          err,
          "This link is no longer valid or has expired — ask your captain for a new one."
        )
      );
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Detect an existing session (public page — read Supabase auth directly).
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      if (!u) return;
      const name =
        (u.user_metadata?.name as string | undefined)?.trim() ||
        u.email?.split("@")[0] ||
        "your account";
      setViewer({ name });
    });
  }, []);

  const saveName = useCallback(async () => {
    const next = nameDraft.trim();
    if (!view || !next || next === view.member.name) return;
    try {
      const supabase = createSupabaseBrowserClient();
      await guestUpdateName(supabase, token, next);
      setView((prev) => (prev ? { ...prev, member: { ...prev.member, name: next } } : prev));
    } catch {
      // Non-fatal — keep the draft; the captain view falls back to the old name.
    }
  }, [nameDraft, view, token]);

  const setStatus = useCallback(
    async (ev: GuestEvent, status: Exclude<RsvpStatus, "no_response">) => {
      // Optimistic: update my_status + recompute counts locally.
      setView((prev) => {
        if (!prev) return prev;
        const key = ev.event_kind === "match" ? "matches" : "practices";
        const list = prev[key].map((e) => {
          if (e.id !== ev.id) return e;
          const prevStatus =
            ev.event_kind === "match"
              ? normalizeMatchStatus(e.my_status ?? "")
              : normalizePracticeStatus(e.my_status ?? "");
          const counts = { ...e.counts };
          if (prevStatus === RSVP.PLAYING) counts.playing = Math.max(0, counts.playing - 1);
          else if (prevStatus === RSVP.MAYBE) counts.maybe = Math.max(0, counts.maybe - 1);
          else if (prevStatus === RSVP.NOT_PLAYING)
            counts.not_playing = Math.max(0, counts.not_playing - 1);
          if (status === RSVP.PLAYING) counts.playing += 1;
          else if (status === RSVP.MAYBE) counts.maybe += 1;
          else if (status === RSVP.NOT_PLAYING) counts.not_playing += 1;
          return { ...e, my_status: status, counts };
        });
        return { ...prev, [key]: list };
      });
      setHasRsvped(true);
      setSubmitted(false); // a new change means there's something fresh to confirm
      const key = evKey(ev);
      setSaveState((s) => ({ ...s, [key]: "saving" }));
      try {
        const supabase = createSupabaseBrowserClient();
        await guestSetAvailability(supabase, {
          token,
          eventKind: ev.event_kind,
          eventId: ev.id,
          status,
        });
        setSaveState((s) => ({ ...s, [key]: "saved" }));
      } catch {
        setSaveState((s) => ({ ...s, [key]: "error" }));
        // Refetch to recover the authoritative state on failure.
        void load();
      }
    },
    [token, load]
  );

  // The big "Submit" affordance: re-saves every answered event (idempotent) so
  // the guest gets one clear confirmation that everything is in, even though
  // each tap already auto-saves.
  const submit = useCallback(async () => {
    if (!view) return;
    const answered = [...view.matches, ...view.practices].filter((e) => {
      const n =
        e.event_kind === "match"
          ? normalizeMatchStatus(e.my_status ?? "")
          : normalizePracticeStatus(e.my_status ?? "");
      return n !== RSVP.NO_RESPONSE;
    });
    if (answered.length === 0) return;
    setSubmitting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      for (const e of answered) {
        const n =
          e.event_kind === "match"
            ? normalizeMatchStatus(e.my_status ?? "")
            : normalizePracticeStatus(e.my_status ?? "");
        await guestSetAvailability(supabase, {
          token,
          eventKind: e.event_kind,
          eventId: e.id,
          status: n,
        });
      }
      setSaveState((prev) => {
        const next = { ...prev };
        for (const e of answered) next[evKey(e)] = "saved";
        return next;
      });
      setSubmitted(true);
    } catch {
      // Leave submitted=false so the button stays available to retry.
      void load();
    } finally {
      setSubmitting(false);
    }
  }, [view, token, load]);

  const answeredCount = view
    ? [...view.matches, ...view.practices].filter((e) => {
        const n =
          e.event_kind === "match"
            ? normalizeMatchStatus(e.my_status ?? "")
            : normalizePracticeStatus(e.my_status ?? "");
        return n !== RSVP.NO_RESPONSE;
      }).length
    : 0;

  if (loadError) {
    return (
      <Centered>
        <p className="text-gray-700 font-medium">Link unavailable</p>
        <p className="text-sm text-gray-500 mt-1">{loadError}</p>
        <Link href="/" className="btn-primary mt-4 inline-block">
          Go home
        </Link>
      </Centered>
    );
  }

  if (!view) {
    return (
      <Centered>
        <div className="skeleton w-64 h-6 rounded mx-auto" />
      </Centered>
    );
  }

  const { group } = view;
  // Carry the guest's chosen name into signup so the register form is prefilled
  // (prefer the live draft in case they just edited it).
  const guestName = (nameDraft.trim() || view.member.name).trim();
  const claimHref =
    `/register?next=${encodeURIComponent(`/rsvp-claim/${token}`)}` +
    (guestName ? `&name=${encodeURIComponent(guestName)}` : "");
  // Log in and return to the claim page, which attaches this placeholder to the
  // account and lands them on the team's availability.
  const loginHref = `/login?next=${encodeURIComponent(`/rsvp-claim/${token}`)}`;
  // Where the account CTAs point: a signed-in viewer goes straight to claim;
  // an anonymous viewer registers first (both end at the claim → team flow).
  const accountHref = viewer ? `/rsvp-claim/${token}` : claimHref;
  const firstName = guestName.split(" ")[0] || "";
  // Nothing to RSVP to yet — show reassurance instead of a dead "submit" button.
  const noEvents = view.matches.length === 0 && view.practices.length === 0 && polls.length === 0;

  return (
    <div className="max-w-md mx-auto px-4 py-8 pb-28">
      {/* Gradient header card */}
      <div className="rounded-3xl bg-gradient-to-br from-court-green to-court-green-soft p-6 text-white shadow-sm">
        <div className="flex items-center gap-3">
          <Avatar name={group.name} image={group.image_url} size="lg" />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/70">
              Set your availability
            </p>
            <h1 className="font-display text-xl font-bold leading-tight truncate">{group.name}</h1>
          </div>
        </div>

        {/* Editable name */}
        <div className="mt-5">
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => void saveName()}
            placeholder="Your name"
            className="w-full rounded-xl px-3 py-2 text-gray-900 bg-white/95 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white"
          />
          <p className="text-[11px] text-white/70 mt-1.5">Not you? Fix your name here.</p>
        </div>
      </div>

      {/* Log in / claim: attach this to a real account so they become a team
          member (works even if they aren't the captain's friend). */}
      {viewer ? (
        <Link
          href={`/rsvp-claim/${token}`}
          className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-court-green-pale/40 bg-court-green/5 px-4 py-3"
        >
          <span className="text-sm text-gray-700 min-w-0">
            Signed in as <span className="font-semibold">{viewer.name}</span> — add yourself to {group.name} and set your availability.
          </span>
          <span className="font-semibold text-court-green shrink-0">Join →</span>
        </Link>
      ) : (
        <p className="mt-3 text-center text-sm text-gray-500">
          Already on TennisFriend?{" "}
          <Link href={loginHref} className="font-semibold text-court-green hover:underline">
            Log in to RSVP as yourself
          </Link>
        </p>
      )}

      {/* Schedule */}
      <div className="mt-6 space-y-6">
        {view.matches.length > 0 && (
          <Section title="Matches">
            {view.matches.map((ev) => (
              <EventCard
                key={`m-${ev.id}`}
                ev={ev}
                groupName={group.name}
                accountHref={accountHref}
                signedIn={!!viewer}
                save={saveState[evKey(ev)]}
                onSelect={(s) => void setStatus(ev, s)}
              />
            ))}
          </Section>
        )}
        {view.practices.length > 0 && (
          <Section title="Practices">
            {view.practices.map((ev) => (
              <EventCard
                key={`p-${ev.id}`}
                ev={ev}
                groupName={group.name}
                accountHref={accountHref}
                signedIn={!!viewer}
                save={saveState[evKey(ev)]}
                onSelect={(s) => void setStatus(ev, s)}
              />
            ))}
          </Section>
        )}
        {polls.length > 0 && (
          <Section title="Availability polls">
            {polls.map((poll) => (
              <GuestPollCard key={poll.id} token={token} poll={poll} />
            ))}
          </Section>
        )}
        {noEvents && (
          <div className="rounded-2xl border border-court-green-pale/40 bg-court-green/5 p-5 text-center">
            <p className="font-display text-lg font-bold text-gray-900">
              You&apos;re on the list{firstName ? `, ${firstName}` : ""}! 🎾
            </p>
            <p className="text-sm text-gray-600 mt-1">
              {group.name} doesn&apos;t have any matches to RSVP to yet. As soon as your
              captain posts one, you&apos;ll set your availability right here — nothing more
              to do for now.
            </p>
            <Link href={accountHref} className="btn-primary mt-4 inline-block w-full">
              {viewer ? "Join the team →" : "Create a free account to get notified →"}
            </Link>
          </div>
        )}
      </div>

      {/* Stronger inline CTA after the first RSVP */}
      {hasRsvped && (
        <div className="mt-6 rounded-2xl border border-court-green-pale/40 bg-court-green/5 p-5 text-center">
          <p className="font-display text-lg font-bold text-gray-900">Nice — you&apos;re in! 🎾</p>
          <p className="text-sm text-gray-600 mt-1">
            {viewer
              ? "Add yourself to the team to get reminders and see who's coming."
              : "Create an account to get reminders and see who's coming."}
          </p>
          <Link href={accountHref} className="btn-primary mt-4 inline-block w-full">
            {viewer ? "Add yourself to the team →" : "Create your free account →"}
          </Link>
        </div>
      )}

      {/* Sticky bottom: Submit (primary affordance) → clear confirmation.
          Hidden when there's nothing to RSVP to (no dead "submit" button). */}
      {!noEvents && (
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur px-4 py-3">
        <div className="max-w-md mx-auto">
          {submitted ? (
            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2 rounded-xl bg-court-green/10 py-2.5 text-court-green font-semibold">
                <CheckIcon /> Availability submitted — your captain can see it.
              </div>
              <Link href={accountHref} className="btn-primary block w-full text-center">
                {viewer ? "Add yourself to the team →" : "Create your free account →"}
              </Link>
            </div>
          ) : (
            <>
              <button
                onClick={() => void submit()}
                disabled={submitting || answeredCount === 0}
                className="btn-primary block w-full text-center disabled:opacity-50"
              >
                {submitting
                  ? "Saving…"
                  : answeredCount === 0
                    ? "Pick your availability above"
                    : `Submit my availability (${answeredCount})`}
              </button>
              <p className="mt-1.5 text-center text-[11px] text-gray-500">
                Your answers also save automatically as you tap.
              </p>
            </>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2 px-1">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function eventToExport(ev: GuestEvent, groupName: string): ExportEvent {
  const title =
    ev.event_kind === "match"
      ? `${groupName} vs ${ev.opponent ?? "TBD"}`
      : `${groupName} — ${ev.series_name || "Practice"}`;
  return {
    id: `${ev.event_kind}-${ev.id}`,
    title,
    date: ev.date,
    time: ev.time,
    location: ev.location,
  };
}

function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if ([y, m, d].some((x) => Number.isNaN(x))) return date;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function EventCard({
  ev,
  groupName,
  accountHref,
  signedIn,
  save,
  onSelect,
}: {
  ev: GuestEvent;
  groupName: string;
  accountHref: string;
  signedIn: boolean;
  save?: "saving" | "saved" | "error";
  onSelect: (status: Exclude<RsvpStatus, "no_response">) => void;
}) {
  const normalized =
    ev.event_kind === "match"
      ? normalizeMatchStatus(ev.my_status ?? "")
      : normalizePracticeStatus(ev.my_status ?? "");
  const pickerValue = normalized === RSVP.NO_RESPONSE ? "" : normalized;
  const subtitle =
    ev.event_kind === "match"
      ? ev.opponent
        ? `vs ${ev.opponent}`
        : "Match"
      : ev.series_name || "Practice";

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-4">
      <div className="flex items-baseline justify-between gap-2 mb-0.5">
        <p className="font-semibold text-gray-900 truncate">{subtitle}</p>
        <p className="text-xs font-medium text-gray-500 shrink-0">{formatDate(ev.date)}</p>
      </div>
      <p className="text-xs text-gray-500">
        {ev.time}
        {ev.location ? ` · ${ev.location}` : ""}
      </p>

      <div className="mt-3 flex items-center gap-2">
        <div className="flex-1">
          <RsvpPicker value={pickerValue} onSelect={onSelect} size="md" />
        </div>
        {save === "saving" && (
          <span className="text-[11px] font-medium text-gray-400 shrink-0">Saving…</span>
        )}
        {save === "saved" && (
          <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-court-green shrink-0">
            <CheckIcon /> Saved
          </span>
        )}
        {save === "error" && (
          <span className="text-[11px] font-semibold text-red-500 shrink-0">Tap again</span>
        )}
      </div>

      <p className="text-xs text-gray-500 mt-2">
        <span className="font-semibold text-court-green">{ev.counts.playing} playing</span> ·{" "}
        {ev.counts.maybe} maybe · {ev.counts.not_playing} out
      </p>

      {/* Locked who's-coming teaser — tap to claim/sign up and reveal it. */}
      <Link
        href={accountHref}
        className="relative mt-2 block overflow-hidden rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2 transition-colors hover:border-court-green-pale hover:bg-court-green/5"
      >
        <p className="text-xs font-medium text-gray-500 blur-[1px] select-none" aria-hidden>
          Alex · Jordan · Sam · Taylor …
        </p>
        <div className="absolute inset-0 flex items-center justify-center bg-white/40">
          <p className="text-[11px] font-semibold text-court-green">
            🔒 {signedIn ? `Join ${groupName} to see who's coming` : "Create a free account to see who's coming"}
          </p>
        </div>
      </Link>

      <CalendarExportButtons event={eventToExport(ev, groupName)} />
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="text-center max-w-sm">{children}</div>
    </div>
  );
}
