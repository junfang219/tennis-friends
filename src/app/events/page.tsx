"use client";

import Link from "next/link";
import { useState } from "react";
import CommunitiesTabs from "@/components/CommunitiesTabs";
import Avatar from "@/components/Avatar";
import { EVENT_TYPE_META } from "@/lib/eventTypeMeta";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { listEvents, getMyProfile } from "@/lib/supabase/queries";
import { useCachedQuery } from "@/lib/useCachedQuery";

type EventListItem = {
  id: string;
  title: string;
  description: string;
  eventType: string;
  startDate: string;
  endDate: string;
  signupDeadline: string | null;
  status: string;
  venueName: string;
  maxParticipants: number | null;
  ntrpMin: number | null;
  ntrpMax: number | null;
  coverImageUrl: string;
  owner: { id: string; name: string; profileImageUrl: string };
  myStatus: "registered" | "waitlist" | "withdrawn" | null;
  registeredCount: number;
};

const FILTER_TABS = [
  { id: "upcoming", label: "Upcoming" },
  { id: "joined", label: "My Events" },
  { id: "past", label: "Past" },
] as const;

type FilterId = (typeof FILTER_TABS)[number]["id"];

export default function EventsListPage() {
  const [filter, setFilter] = useState<FilterId>("upcoming");

  const eventsQuery = useCachedQuery<EventListItem[]>(
    `events:list:${filter}`,
    async () => {
      const supabase = createSupabaseBrowserClient();
      const rows = await listEvents(supabase, { upcoming: filter === "upcoming" });
      return rows.map((e) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        eventType: e.event_type,
        startDate: e.start_date,
        endDate: e.end_date,
        signupDeadline: e.signup_deadline,
        status: e.status,
        venueName: e.venue_name,
        maxParticipants: e.max_participants,
        ntrpMin: e.ntrp_min,
        ntrpMax: e.ntrp_max,
        coverImageUrl: e.cover_image_url,
        owner: { id: e.owner_id, name: "", profileImageUrl: "" },
        myStatus: null,
        registeredCount: 0,
      }));
    },
  );
  const events = eventsQuery.data ?? [];
  const loading = eventsQuery.isLoading;

  // Reuses the cached "my profile" snapshot populated by /profile so the
  // location-banner check doesn't fire a second getMyProfile.
  const profileQuery = useCachedQuery<{ latitude: number | null; longitude: number | null } | null>(
    "events:profile-location",
    async () => {
      const supabase = createSupabaseBrowserClient();
      const p = await getMyProfile(supabase);
      if (!p) return null;
      return { latitude: p.latitude, longitude: p.longitude };
    },
  );
  const hasLocation =
    profileQuery.data === undefined
      ? null
      : profileQuery.data === null
      ? null
      : profileQuery.data.latitude != null && profileQuery.data.longitude != null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <CommunitiesTabs />

      <div className="animate-fade-in-up flex items-start justify-between mb-6 gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-court-green mb-1">
            Events
          </h1>
          <p className="text-gray-500 text-sm">
            Tournaments, round-robins, mixers & clinics
          </p>
        </div>
        <Link href="/events/new" className="btn-primary btn-sm shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Event
        </Link>
      </div>

      {hasLocation === false && filter === "upcoming" && (
        <div className="mb-4 bg-ball-yellow/20 border border-ball-yellow/40 rounded-xl px-4 py-3 text-sm text-gray-700 flex items-start gap-3">
          <span className="text-base">📍</span>
          <div className="flex-1">
            <div className="font-semibold text-gray-900 mb-0.5">Set your location</div>
            <p className="text-xs text-gray-600">
              Add a home location in your profile to see public events near you.{" "}
              <Link href="/profile/settings" className="text-court-green underline">
                Update profile
              </Link>
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 mb-5 bg-gray-100 p-1 rounded-full w-fit">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              filter === tab.id
                ? "bg-white text-court-green shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl p-5 shadow-sm">
              <div className="skeleton w-3/4 h-5 mb-2" />
              <div className="skeleton w-1/2 h-4" />
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center shadow-sm">
          <div className="text-4xl mb-2">🎾</div>
          <h3 className="font-semibold text-gray-700 mb-1">
            {filter === "joined" ? "You haven't joined any events yet" : "No events here yet"}
          </h3>
          <p className="text-sm text-gray-500 mb-5">
            {filter === "upcoming"
              ? "Be the first to organize one — start a tournament, round-robin, mixer, or clinic."
              : filter === "joined"
              ? "Browse upcoming events and sign up to play."
              : "Past events you organized or joined will show up here."}
          </p>
          {filter !== "past" && (
            <Link href="/events/new" className="btn-primary btn-sm">
              Create an event
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventCard({ event }: { event: EventListItem }) {
  const typeMeta = EVENT_TYPE_META[event.eventType] ?? EVENT_TYPE_META.mixer;
  const myStatusLabel =
    event.myStatus === "registered"
      ? "Signed up"
      : event.myStatus === "waitlist"
      ? "Waitlisted"
      : null;

  return (
    <Link
      href={`/events/${event.id}`}
      className="block bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow"
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg shrink-0 ${typeMeta.bg}`}
        >
          {typeMeta.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-[10px] font-bold uppercase tracking-wide ${typeMeta.text}`}>
              {typeMeta.label}
            </span>
            {myStatusLabel && (
              <span className="text-[10px] font-bold uppercase tracking-wide text-court-green">
                · {myStatusLabel}
              </span>
            )}
          </div>
          <h3 className="font-semibold text-gray-900 truncate">{event.title}</h3>
          <div className="text-xs text-gray-500 mt-1 space-y-0.5">
            <div>{formatDateRange(event.startDate, event.endDate)}</div>
            {event.venueName && <div>📍 {event.venueName}</div>}
            <div className="flex items-center gap-3">
              <span>
                👤 {event.registeredCount}
                {event.maxParticipants ? `/${event.maxParticipants}` : ""} signed up
              </span>
              {(event.ntrpMin != null || event.ntrpMax != null) && (
                <span>
                  NTRP {event.ntrpMin ?? "?"}–{event.ntrpMax ?? "?"}
                </span>
              )}
            </div>
          </div>
        </div>
        <Avatar
          name={event.owner.name}
          image={event.owner.profileImageUrl}
          size="sm"
        />
      </div>
    </Link>
  );
}

function formatDateRange(startISO: string, endISO: string): string {
  const start = new Date(startISO);
  const end = new Date(endISO);
  const sameDay = start.toDateString() === end.toDateString();
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const startStr = start.toLocaleDateString(undefined, opts);
  if (sameDay) {
    const timeStr = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return `${startStr} · ${timeStr}`;
  }
  const endStr = end.toLocaleDateString(undefined, opts);
  return `${startStr} – ${endStr}`;
}
