"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Avatar from "@/components/Avatar";
import { EVENT_TYPE_META } from "../page";

type Participant = {
  id: string;
  userId: string;
  status: "registered" | "waitlist" | "withdrawn";
  registeredAt: string;
  user: {
    id: string;
    name: string;
    profileImageUrl: string;
    ntrpRating: number | null;
  };
};

type EventDetail = {
  id: string;
  ownerId: string;
  groupId: string | null;
  title: string;
  description: string;
  eventType: string;
  startDate: string;
  endDate: string;
  signupDeadline: string | null;
  isPublicSignup: boolean;
  maxParticipants: number | null;
  ntrpMin: number | null;
  ntrpMax: number | null;
  status: "open" | "closed" | "active" | "completed" | "cancelled";
  venueName: string;
  venueAddress: string;
  coverImageUrl: string;
  owner: { id: string; name: string; profileImageUrl: string };
  participants: Participant[];
  myStatus: "registered" | "waitlist" | "withdrawn" | null;
  registeredCount: number;
  waitlistCount: number;
};

export default function EventDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionInFlight, setActionInFlight] = useState(false);
  const [error, setError] = useState("");
  const [showRoster, setShowRoster] = useState(false);

  const load = () => {
    fetch(`/api/events/${params.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setEvent(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function signup() {
    if (!event) return;
    setActionInFlight(true);
    setError("");
    const res = await fetch(`/api/events/${event.id}/signup`, { method: "POST" });
    setActionInFlight(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error || "Couldn't sign up. Try again.");
      return;
    }
    load();
  }

  async function withdraw() {
    if (!event) return;
    if (!confirm("Withdraw from this event?")) return;
    setActionInFlight(true);
    setError("");
    const res = await fetch(`/api/events/${event.id}/signup`, { method: "DELETE" });
    setActionInFlight(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error || "Couldn't withdraw.");
      return;
    }
    load();
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="skeleton w-full h-40 rounded-2xl mb-4" />
        <div className="skeleton w-2/3 h-6 mb-2" />
        <div className="skeleton w-1/2 h-4" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <h2 className="text-xl font-semibold text-gray-700 mb-2">Event not found</h2>
        <Link href="/events" className="text-court-green hover:underline">
          Back to events
        </Link>
      </div>
    );
  }

  const typeMeta = EVENT_TYPE_META[event.eventType] ?? EVENT_TYPE_META.mixer;
  const isOwner = session?.user?.id === event.ownerId;
  const showMatchesAction = event.eventType !== "clinic";
  const showStandingsAction = event.eventType !== "clinic" && event.eventType !== "mixer";
  const registered = event.participants.filter((p) => p.status === "registered");
  const waitlist = event.participants.filter((p) => p.status === "waitlist");
  const signupDeadlinePassed =
    event.signupDeadline != null && new Date(event.signupDeadline) < new Date();
  const eventEnded = new Date(event.endDate) < new Date();
  const canSignup =
    !isOwner &&
    !signupDeadlinePassed &&
    !eventEnded &&
    event.status !== "cancelled" &&
    event.status !== "completed" &&
    (event.myStatus == null || event.myStatus === "withdrawn");

  return (
    <div className="max-w-2xl mx-auto pb-12">
      {/* Cover */}
      <div
        className={`relative h-44 ${typeMeta.bg} flex items-end p-5`}
        style={
          event.coverImageUrl
            ? {
                backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 100%), url(${event.coverImageUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      >
        <button
          onClick={() => router.push("/events")}
          aria-label="Back to events"
          className="absolute top-3 left-3 bg-white/90 hover:bg-white text-gray-700 w-9 h-9 rounded-full flex items-center justify-center shadow-sm"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="15,18 9,12 15,6" />
          </svg>
        </button>
        <div className={`${event.coverImageUrl ? "text-white" : "text-court-green"}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${event.coverImageUrl ? "bg-white/20 backdrop-blur" : "bg-white/70"} ${typeMeta.text}`}>
              <span>{typeMeta.emoji}</span> {typeMeta.label}
            </span>
            <StatusBadge status={event.status} dimmed={!!event.coverImageUrl} />
          </div>
          <h1 className="font-display text-2xl font-bold leading-tight drop-shadow-sm">
            {event.title}
          </h1>
        </div>
      </div>

      <div className="px-4 pt-5 space-y-5">
        {/* Meta line */}
        <div className="text-sm text-gray-600 space-y-1">
          <div className="flex items-center gap-2">
            <span>📅</span>
            <span>{formatDateRange(event.startDate, event.endDate)}</span>
          </div>
          {event.venueName && (
            <div className="flex items-center gap-2">
              <span>📍</span>
              <span>
                {event.venueName}
                {event.venueAddress && <span className="text-gray-400"> · {event.venueAddress}</span>}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span>👤</span>
            <span>
              {event.registeredCount}
              {event.maxParticipants ? `/${event.maxParticipants}` : ""} signed up
              {event.waitlistCount > 0 && (
                <span className="text-gray-400"> · {event.waitlistCount} on waitlist</span>
              )}
            </span>
          </div>
          {(event.ntrpMin != null || event.ntrpMax != null) && (
            <div className="flex items-center gap-2">
              <span>🎯</span>
              <span>
                NTRP {event.ntrpMin ?? "?"}–{event.ntrpMax ?? "?"}
              </span>
            </div>
          )}
          {event.signupDeadline && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>⏰</span>
              <span>Signup closes {new Date(event.signupDeadline).toLocaleString()}</span>
            </div>
          )}
        </div>

        {/* Signup action */}
        <div className="flex items-center gap-3 flex-wrap">
          {isOwner ? (
            <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-court-green/10 text-court-green text-xs font-semibold">
              Organizer
            </span>
          ) : event.myStatus === "registered" ? (
            <button
              onClick={withdraw}
              disabled={actionInFlight}
              className="px-4 py-2 rounded-full bg-court-green text-white text-sm font-semibold hover:bg-court-green-light disabled:opacity-60"
            >
              {actionInFlight ? "…" : "✓ Signed up · Withdraw"}
            </button>
          ) : event.myStatus === "waitlist" ? (
            <button
              onClick={withdraw}
              disabled={actionInFlight}
              className="px-4 py-2 rounded-full bg-ball-yellow/80 text-court-green text-sm font-semibold hover:bg-ball-yellow disabled:opacity-60"
            >
              {actionInFlight ? "…" : "🕒 Waitlisted · Withdraw"}
            </button>
          ) : canSignup ? (
            <button
              onClick={signup}
              disabled={actionInFlight}
              className="px-4 py-2 rounded-full bg-court-green text-white text-sm font-semibold hover:bg-court-green-light disabled:opacity-60"
            >
              {actionInFlight ? "…" : "Sign up"}
            </button>
          ) : (
            <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-gray-100 text-gray-500 text-xs font-semibold">
              {signupDeadlinePassed ? "Signup closed" : eventEnded ? "Event ended" : "Not available"}
            </span>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {/* Description */}
        {event.description && (
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{event.description}</p>
        )}

        {/* Action grid */}
        <div className="grid grid-cols-4 gap-2">
          <ActionButton
            label="Chat"
            emoji="💬"
            href={event.groupId ? `/groups/${event.groupId}/chat` : undefined}
            disabled={!event.groupId}
          />
          <ActionButton
            label="Roster"
            emoji="👥"
            onClick={() => setShowRoster((v) => !v)}
            active={showRoster}
          />
          <ActionButton
            label="Matches"
            emoji="🎾"
            disabled={!showMatchesAction}
            comingSoon={showMatchesAction}
          />
          <ActionButton
            label={event.eventType === "tournament" ? "Bracket" : "Standings"}
            emoji={event.eventType === "tournament" ? "🏆" : "📊"}
            disabled={!showStandingsAction}
            comingSoon={showStandingsAction}
          />
        </div>

        {/* Roster section */}
        {showRoster && (
          <section className="bg-white rounded-2xl p-5 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-3">
              Signed up · {registered.length}
            </h3>
            {registered.length === 0 ? (
              <p className="text-sm text-gray-500">No one yet — be the first.</p>
            ) : (
              <ul className="space-y-2">
                {registered.map((p) => (
                  <RosterRow key={p.id} participant={p} />
                ))}
              </ul>
            )}
            {waitlist.length > 0 && (
              <>
                <h3 className="font-semibold text-gray-900 mt-5 mb-3">
                  Waitlist · {waitlist.length}
                </h3>
                <ul className="space-y-2">
                  {waitlist.map((p) => (
                    <RosterRow key={p.id} participant={p} />
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        {/* Find-a-partner placeholder (Phase 2) */}
        {event.myStatus === "registered" && (
          <section className="bg-white rounded-2xl p-5 shadow-sm border border-dashed border-gray-200">
            <h3 className="font-semibold text-gray-900 mb-1">Find a match partner</h3>
            <p className="text-sm text-gray-500">
              Match-within-event posts arrive in Phase 2. For now, use the event chat to coordinate.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status, dimmed }: { status: string; dimmed: boolean }) {
  const label =
    status === "open"
      ? "Open"
      : status === "closed"
      ? "Closed"
      : status === "active"
      ? "Active"
      : status === "completed"
      ? "Completed"
      : status === "cancelled"
      ? "Cancelled"
      : status;
  const colors: Record<string, string> = {
    open: "bg-court-green/10 text-court-green",
    closed: "bg-gray-200 text-gray-600",
    active: "bg-ball-yellow/30 text-court-green",
    completed: "bg-gray-200 text-gray-600",
    cancelled: "bg-red-100 text-red-700",
  };
  const cls = dimmed ? "bg-white/20 backdrop-blur text-white" : colors[status] ?? colors.open;
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${cls}`}>
      {label}
    </span>
  );
}

function ActionButton({
  label,
  emoji,
  href,
  onClick,
  disabled,
  active,
  comingSoon,
}: {
  label: string;
  emoji: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  comingSoon?: boolean;
}) {
  const base =
    "flex flex-col items-center justify-center py-3 rounded-xl text-xs font-semibold transition-colors";
  const styled = active
    ? "bg-court-green text-white"
    : disabled
    ? "bg-gray-50 text-gray-400"
    : "bg-white text-gray-700 hover:bg-gray-50 shadow-sm";
  const content = (
    <>
      <span className="text-lg mb-0.5">{emoji}</span>
      <span>{label}</span>
      {comingSoon && <span className="text-[9px] text-gray-400 font-normal">Soon</span>}
    </>
  );
  if (href && !disabled) {
    return (
      <Link href={href} className={`${base} ${styled}`}>
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`${base} ${styled}`}
    >
      {content}
    </button>
  );
}

function RosterRow({ participant }: { participant: Participant }) {
  return (
    <li className="flex items-center gap-3">
      <Avatar name={participant.user.name} image={participant.user.profileImageUrl} size="sm" />
      <Link
        href={`/profile/${participant.user.id}`}
        className="text-sm font-medium text-gray-900 hover:underline flex-1 min-w-0 truncate"
      >
        {participant.user.name}
      </Link>
      {participant.user.ntrpRating != null && (
        <span className="text-[11px] text-gray-500 shrink-0">
          NTRP {participant.user.ntrpRating.toFixed(1)}
        </span>
      )}
    </li>
  );
}

function formatDateRange(startISO: string, endISO: string): string {
  const start = new Date(startISO);
  const end = new Date(endISO);
  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    return `${start.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    })} · ${start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} – ${end.toLocaleTimeString(
      undefined,
      { hour: "numeric", minute: "2-digit" }
    )}`;
  }
  return `${start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}
