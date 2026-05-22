"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/supabase/nextauth-compat";
import Avatar from "@/components/Avatar";
import { EVENT_TYPE_META } from "@/lib/eventTypeMeta";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  getEvent,
  getGroup,
  listEventParticipants,
  listEventMatches,
  signupForEvent,
  withdrawFromEvent,
  listFriends,
} from "@/lib/supabase/queries";
import MatchList from "@/components/events/MatchList";
import BracketView from "@/components/events/BracketView";
import StandingsTable from "@/components/events/StandingsTable";
import LadderList from "@/components/events/LadderList";
import RotationCard from "@/components/events/RotationCard";
import CheckinDrawer from "@/components/events/CheckinDrawer";
import FindPartnerComposer from "@/components/events/FindPartnerComposer";

type Participant = {
  id: string;
  userId: string;
  status: "registered" | "waitlist" | "withdrawn";
  checkedInAt: string | null;
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
  visibility: "public" | "group";
  radiusMi: number | null;
  hostGroupId: string | null;
  hostGroup: { id: string; name: string } | null;
  owner: { id: string; name: string; profileImageUrl: string };
  participants: Participant[];
  myStatus: "registered" | "waitlist" | "withdrawn" | null;
  registeredCount: number;
  waitlistCount: number;
  matchCount: number;
  hasBracket: boolean;
};

type PanelKey = "matches" | "bracket" | "standings" | "rotations" | "roster";

export default function EventDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusMatchId = searchParams.get("match") ?? null;
  const { data: session } = useSession();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionInFlight, setActionInFlight] = useState(false);
  const [error, setError] = useState("");
  const [activePanel, setActivePanel] = useState<PanelKey | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showCheckin, setShowCheckin] = useState(false);
  const [showFindPartner, setShowFindPartner] = useState(false);

  // If we arrived via a match-deep-link, auto-open the Matches panel.
  useEffect(() => {
    if (focusMatchId) setActivePanel("matches");
  }, [focusMatchId]);

  const load = async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      const id = String(params.id);
      const myId = session?.user?.id ?? null;
      const [ev, participants, matches] = await Promise.all([
        getEvent(supabase, id),
        listEventParticipants(supabase, id),
        listEventMatches(supabase, id),
      ]);
      if (!ev) {
        setEvent(null);
        setLoading(false);
        return;
      }
      // Fetch host group label if this event is locked to one. Falls back
      // to null on missing row / failed read — the host-group chip just
      // renders without the link.
      const hostGroup = ev.host_group_id
        ? await getGroup(supabase, ev.host_group_id)
            .then((g) => (g ? { id: g.id, name: g.name } : null))
            .catch(() => null)
        : null;
      // Adapt the snake_case Supabase shape to the page's camelCase types.
      const adapted = {
        id: ev.id,
        ownerId: ev.owner_id,
        groupId: ev.group_id,
        title: ev.title,
        description: ev.description,
        eventType: ev.event_type,
        startDate: ev.start_date,
        endDate: ev.end_date,
        signupDeadline: ev.signup_deadline,
        isPublicSignup: ev.is_public_signup,
        maxParticipants: ev.max_participants,
        ntrpMin: ev.ntrp_min,
        ntrpMax: ev.ntrp_max,
        status: ev.status,
        venueName: ev.venue_name,
        venueAddress: ev.venue_address,
        visibility: ev.visibility,
        eventLat: ev.event_lat,
        eventLng: ev.event_lng,
        radiusMi: ev.radius_mi,
        hostGroupId: ev.host_group_id,
        config: ev.config,
        coverImageUrl: ev.cover_image_url,
        seasonId: ev.season_id,
        owner: { id: ev.owner_id, name: "", profileImageUrl: "" },
        participants: participants.map<Participant>((p) => ({
          id: p.id,
          userId: p.user_id,
          status: p.status as Participant["status"],
          checkedInAt: p.checked_in_at,
          user: {
            id: p.user.id,
            name: p.user.name,
            profileImageUrl: p.user.profile_image_url,
            ntrpRating: p.user.ntrp_rating,
          },
        })),
        matches: matches.map((m) => ({
          id: m.id,
          eventId: m.event_id,
          player1Id: m.player1_id,
          player2Id: m.player2_id,
          player3Id: m.player3_id,
          player4Id: m.player4_id,
          round: m.round,
          bracketSlot: m.bracket_slot,
          scheduledAt: m.scheduled_at,
          courtAssign: m.court_assign,
          score: m.score,
          winnerSide: m.winner_side,
          status: m.status,
        })),
        hostGroup,
        myStatus: ((): EventDetail["myStatus"] => {
          if (!myId) return null;
          const me = participants.find((p) => p.user_id === myId);
          if (!me) return null;
          const s = me.status;
          if (s === "registered" || s === "waitlist" || s === "withdrawn") return s;
          return null;
        })(),
        registeredCount: participants.filter((p) => p.status === "registered").length,
        waitlistCount: participants.filter((p) => p.status === "waitlist").length,
        matchCount: matches.length,
        // Any match with a bracket slot assigned means the bracket has been
        // generated — used by the signup-lock check for tournaments.
        hasBracket: matches.some((m) => m.bracket_slot != null),
      };
      setEvent(adapted);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function signup() {
    if (!event) return;
    setActionInFlight(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      await signupForEvent(supabase, event.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign up. Try again.");
    } finally {
      setActionInFlight(false);
    }
  }

  async function withdraw() {
    if (!event) return;
    if (!confirm("Withdraw from this event?")) return;
    setActionInFlight(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      await withdrawFromEvent(supabase, event.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't withdraw.");
    } finally {
      setActionInFlight(false);
    }
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
  const currentUserId = session?.user?.id ?? null;
  const registered = event.participants.filter((p) => p.status === "registered");
  const waitlist = event.participants.filter((p) => p.status === "waitlist");
  const signupDeadlinePassed =
    event.signupDeadline != null && new Date(event.signupDeadline) < new Date();
  const eventEnded = new Date(event.endDate) < new Date();
  const tournamentLocked = event.eventType === "tournament" && event.hasBracket;
  // Organizers can sign up like anyone else — being the organizer doesn't
  // make them a player. They see organizer actions AND signup buttons.
  const canSignup =
    !signupDeadlinePassed &&
    !eventEnded &&
    !tournamentLocked &&
    event.status !== "cancelled" &&
    event.status !== "completed" &&
    (event.myStatus == null || event.myStatus === "withdrawn");

  const surfaceKey: PanelKey | null =
    typeMeta.competitiveSurface === "bracket"
      ? "bracket"
      : typeMeta.competitiveSurface === "standings"
      ? "standings"
      : typeMeta.competitiveSurface === "rotations"
      ? "rotations"
      : null;
  const surfaceLabel =
    surfaceKey === "bracket"
      ? "Bracket"
      : surfaceKey === "standings"
      ? "Standings"
      : surfaceKey === "rotations"
      ? "Rotations"
      : "";
  const surfaceEmoji =
    surfaceKey === "bracket"
      ? "🏆"
      : surfaceKey === "standings"
      ? "📊"
      : surfaceKey === "rotations"
      ? "🔁"
      : "";

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
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${event.coverImageUrl ? "bg-white/20 backdrop-blur" : "bg-white/70"} ${typeMeta.text}`}>
              <span>{typeMeta.emoji}</span> {typeMeta.label}
            </span>
            <StatusBadge status={event.status} dimmed={!!event.coverImageUrl} />
            <VisibilityBadge
              visibility={event.visibility}
              radiusMi={event.radiusMi}
              hostGroup={event.hostGroup}
              dimmed={!!event.coverImageUrl}
            />
          </div>
          <h1 className="font-display text-2xl font-bold leading-tight drop-shadow-sm">
            {event.title}
          </h1>
        </div>
      </div>

      <div className="px-4 pt-5 space-y-5">
        {/* Tournament lock banner */}
        {tournamentLocked && (
          <div className="bg-clay/10 border border-clay/30 text-clay text-sm rounded-xl px-4 py-3">
            🔒 Bracket is live — signups are locked.
          </div>
        )}

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

        {/* Signup + organizer actions */}
        <div className="flex items-center gap-3 flex-wrap">
          {isOwner && (
            <>
              <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-court-green/10 text-court-green text-xs font-semibold">
                Organizer
              </span>
              <button
                onClick={() => setShowInvite(true)}
                className="px-4 py-2 rounded-full bg-court-green text-white text-sm font-semibold hover:bg-court-green-light"
              >
                + Invite friends
              </button>
              <Link
                href={`/events/${event.id}/edit`}
                className="px-4 py-2 rounded-full bg-white border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50"
              >
                Edit
              </Link>
            </>
          )}
          {event.myStatus === "registered" ? (
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
              className={`px-4 py-2 rounded-full text-sm font-semibold disabled:opacity-60 ${
                isOwner
                  ? "bg-white border border-court-green/30 text-court-green hover:bg-court-green/5"
                  : "bg-court-green text-white hover:bg-court-green-light"
              }`}
            >
              {actionInFlight ? "…" : isOwner ? "Sign up to play" : "Sign up"}
            </button>
          ) : !isOwner ? (
            <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-gray-100 text-gray-500 text-xs font-semibold">
              {tournamentLocked
                ? "Bracket locked"
                : signupDeadlinePassed
                ? "Signup closed"
                : eventEnded
                ? "Event ended"
                : "Not available"}
            </span>
          ) : null}
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
        <div className={`grid ${isOwner ? "grid-cols-5" : "grid-cols-4"} gap-2`}>
          <ActionButton
            label="Chat"
            emoji="💬"
            href={event.groupId ? `/groups/${event.groupId}/chat` : undefined}
            disabled={!event.groupId}
          />
          <ActionButton
            label="Roster"
            emoji="👥"
            active={activePanel === "roster"}
            onClick={() => togglePanel("roster", activePanel, setActivePanel)}
          />
          {typeMeta.supportsMatches ? (
            <ActionButton
              label="Matches"
              emoji="🎾"
              active={activePanel === "matches"}
              onClick={() => togglePanel("matches", activePanel, setActivePanel)}
            />
          ) : (
            <ActionButton label="Matches" emoji="🎾" disabled />
          )}
          {surfaceKey ? (
            <ActionButton
              label={surfaceLabel}
              emoji={surfaceEmoji}
              active={activePanel === surfaceKey}
              onClick={() => togglePanel(surfaceKey, activePanel, setActivePanel)}
            />
          ) : (
            <ActionButton label="Standings" emoji="📊" disabled />
          )}
          {isOwner && (
            <ActionButton
              label="Check-in"
              emoji="✅"
              onClick={() => setShowCheckin(true)}
            />
          )}
        </div>

        {/* Roster section */}
        {activePanel === "roster" && (
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

        {/* Matches panel */}
        {activePanel === "matches" && typeMeta.supportsMatches && (
          <section className="bg-white rounded-2xl p-4 shadow-sm">
            <MatchList
              eventId={event.id}
              currentUserId={currentUserId}
              focusMatchId={focusMatchId}
              onChanged={load}
            />
          </section>
        )}

        {/* Bracket panel */}
        {activePanel === "bracket" && surfaceKey === "bracket" && (
          <BracketView
            eventId={event.id}
            isOwner={isOwner}
            onSeeded={load}
          />
        )}

        {/* Standings panel */}
        {activePanel === "standings" && surfaceKey === "standings" && (
          <StandingsTable eventId={event.id} currentUserId={currentUserId} />
        )}

        {/* Rotations panel */}
        {activePanel === "rotations" && surfaceKey === "rotations" && (
          <RotationCard
            eventId={event.id}
            isOwner={isOwner}
            onChanged={load}
          />
        )}

        {/* Ladder always-on inline list — challenges live here, not in a modal */}
        {event.eventType === "ladder" && (
          <section>
            <h3 className="font-semibold text-gray-900 mb-2 px-1">Ladder</h3>
            <LadderList eventId={event.id} currentUserId={currentUserId} />
          </section>
        )}

        {/* Find-a-partner CTA — registered participants only */}
        {event.myStatus === "registered" && (
          <section className="bg-white rounded-2xl p-5 shadow-sm border border-court-green-pale/30">
            <h3 className="font-semibold text-gray-900 mb-1">Find a match partner</h3>
            <p className="text-sm text-gray-500 mb-3">
              Post a quick note to the event chat and the discover feed.
            </p>
            <button
              onClick={() => setShowFindPartner(true)}
              className="px-4 py-2 rounded-full bg-court-green text-white text-sm font-semibold hover:bg-court-green-light"
            >
              + New post
            </button>
          </section>
        )}
      </div>

      {showInvite && (
        <InviteFriendsModal
          eventId={event.id}
          alreadyKnownUserIds={new Set(event.participants.map((p) => p.userId))}
          onClose={() => setShowInvite(false)}
          onSent={() => {
            setShowInvite(false);
            load();
          }}
        />
      )}

      {showCheckin && (
        <CheckinDrawer
          eventId={event.id}
          participants={event.participants}
          onClose={() => setShowCheckin(false)}
          onChanged={load}
        />
      )}

      {showFindPartner && (
        <FindPartnerComposer
          eventId={event.id}
          eventTitle={event.title}
          defaultSkillMin={event.ntrpMin}
          defaultSkillMax={event.ntrpMax}
          onClose={() => setShowFindPartner(false)}
          onPosted={() => {
            setShowFindPartner(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function togglePanel(
  next: PanelKey,
  current: PanelKey | null,
  setActive: (k: PanelKey | null) => void
) {
  setActive(current === next ? null : next);
}

function InviteFriendsModal({
  eventId,
  alreadyKnownUserIds,
  onClose,
  onSent,
}: {
  eventId: string;
  alreadyKnownUserIds: Set<string>;
  onClose: () => void;
  onSent: (sentCount: number) => void;
}) {
  const [friends, setFriends] = useState<
    { friendshipId: string; user: { id: string; name: string; profileImageUrl: string; skillLevel: string } }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    listFriends(supabase)
      .then((rows) => {
        setFriends(
          rows.map((u) => ({
            friendshipId: u.id,
            user: {
              id: u.id,
              name: u.name,
              profileImageUrl: u.profile_image_url,
              skillLevel: u.skill_level,
            },
          }))
        );
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = friends.filter((f) =>
    f.user.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  async function send() {
    if (selectedIds.size === 0 || sending) return;
    setSending(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        setError("Not signed in.");
        setSending(false);
        return;
      }
      // Invites = notifications of type "event_invite" pointing at the event.
      const rows = Array.from(selectedIds).map((uid) => ({
        user_id: uid,
        actor_id: auth.user!.id,
        type: "event_invite" as const,
        event_id: eventId,
      }));
      const { error: insErr } = await supabase.from("notifications").insert(rows);
      if (insErr) {
        setError(insErr.message);
        setSending(false);
        return;
      }
      onSent(selectedIds.size);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Try again.");
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="font-display text-lg font-bold text-gray-900">Invite friends</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-5 pt-4 pb-3">
          <div className="relative">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search friends…"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-court-green"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-3">
          {loading ? (
            <p className="text-sm text-gray-500 text-center py-10">Loading friends…</p>
          ) : friends.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-10">
              You don&apos;t have any friends yet. Add friends first, then invite them.
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-10">No matches.</p>
          ) : (
            <ul className="space-y-1">
              {filtered.map((f) => {
                const known = alreadyKnownUserIds.has(f.user.id);
                const selected = selectedIds.has(f.user.id);
                return (
                  <li key={f.user.id}>
                    <button
                      type="button"
                      onClick={() => !known && toggle(f.user.id)}
                      disabled={known}
                      className={`w-full flex items-center gap-3 p-2.5 rounded-xl transition-all text-left ${
                        known
                          ? "opacity-50 cursor-not-allowed"
                          : selected
                          ? "bg-court-green-soft/10 ring-1 ring-court-green-soft/30"
                          : "hover:bg-gray-50"
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all shrink-0 ${
                          selected
                            ? "bg-court-green border-court-green"
                            : "border-gray-300"
                        }`}
                      >
                        {selected && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
                            <polyline points="20,6 9,17 4,12" />
                          </svg>
                        )}
                      </div>
                      <Avatar name={f.user.name} image={f.user.profileImageUrl} size="sm" />
                      <span className="flex-1 text-sm font-medium text-gray-800 truncate">
                        {f.user.name}
                      </span>
                      {known && (
                        <span className="text-[10px] text-gray-400 shrink-0">already in</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error && (
          <div className="mx-5 mb-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="p-4 border-t border-gray-100 flex items-center gap-3">
          <button
            onClick={send}
            disabled={selectedIds.size === 0 || sending}
            className="btn-primary flex-1"
          >
            {sending
              ? "Sending…"
              : selectedIds.size === 0
              ? "Pick friends"
              : `Send ${selectedIds.size} ${selectedIds.size === 1 ? "invite" : "invites"}`}
          </button>
          <button
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-700 px-2"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function VisibilityBadge({
  visibility,
  radiusMi,
  hostGroup,
  dimmed,
}: {
  visibility: "public" | "group";
  radiusMi: number | null;
  hostGroup: { id: string; name: string } | null;
  dimmed: boolean;
}) {
  const base = "inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full";
  const cls = dimmed ? "bg-white/20 backdrop-blur text-white" : "bg-white/70 text-court-green";
  if (visibility === "group") {
    const label = hostGroup ? `🔒 ${hostGroup.name}` : "🔒 Group";
    if (hostGroup) {
      return (
        <Link href={`/groups/${hostGroup.id}`} className={`${base} ${cls} hover:opacity-90`}>
          {label}
        </Link>
      );
    }
    return <span className={`${base} ${cls}`}>{label}</span>;
  }
  return (
    <span className={`${base} ${cls}`}>
      🌎 Public{radiusMi ? ` · ${radiusMi} mi` : ""}
    </span>
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
}: {
  label: string;
  emoji: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
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
      {participant.checkedInAt && (
        <span className="text-[10px] text-court-green font-semibold shrink-0">
          ✓ in
        </span>
      )}
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
