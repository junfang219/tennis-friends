"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { listMyGroups, createEvent } from "@/lib/supabase/queries";
import { getCurrentPosition, isPositionError } from "@/lib/getCurrentPosition";
import { errorMessage } from "@/lib/errorMessage";

const TYPES = [
  { id: "tournament", label: "Tournament", emoji: "🏆", blurb: "Single-elimination bracket. Organizer seeds pairings." },
  { id: "round_robin", label: "Round Robin", emoji: "🔁", blurb: "Everyone plays everyone. Standings auto-update." },
  { id: "ladder", label: "Ladder", emoji: "🪜", blurb: "Climb the rankings by challenging players above you. Ongoing." },
  { id: "mixer", label: "Social Mixer", emoji: "🤝", blurb: "Partners rotate each round. Casual play." },
  { id: "clinic", label: "Clinic", emoji: "🎾", blurb: "Drop-in lesson or practice. No matches required." },
  { id: "custom", label: "Custom", emoji: "✨", blurb: "Anything else — watch parties, brunch hangs, off-court socials. No format imposed." },
] as const;

type TypeId = (typeof TYPES)[number]["id"];
type Visibility = "public" | "group";
type GroupOption = { id: string; name: string };

const RADII = [5, 10, 25, 50] as const;
const DEFAULT_RADIUS = 25;
type GeocodeState = "idle" | "loading" | "ok" | "not_found" | "error";

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

  // Visibility state.
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [eventLat, setEventLat] = useState<number | null>(null);
  const [eventLng, setEventLng] = useState<number | null>(null);
  const [radiusMi, setRadiusMi] = useState<(typeof RADII)[number]>(DEFAULT_RADIUS);
  const [geocodeState, setGeocodeState] = useState<GeocodeState>("idle");
  const [locatingMe, setLocatingMe] = useState(false);
  const [hostGroupId, setHostGroupId] = useState("");
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);

  // Load the user's non-event-backed groups when the group branch is chosen.
  useEffect(() => {
    if (visibility !== "group" || groups.length > 0 || groupsLoading) return;
    setGroupsLoading(true);
    const supabase = createSupabaseBrowserClient();
    listMyGroups(supabase)
      .then((rows) => setGroups(rows.map((g) => ({ id: g.id, name: g.name }))))
      .catch(() => setGroups([]))
      .finally(() => setGroupsLoading(false));
  }, [visibility, groups.length, groupsLoading]);

  // Debounced geocode whenever the address settles.
  useEffect(() => {
    if (visibility !== "public") return;
    const q = venueAddress.trim();
    if (!q) {
      setGeocodeState("idle");
      return;
    }
    setGeocodeState("loading");
    const handle = setTimeout(() => {
      let cancelled = false;
      // Geocode via Nominatim directly from the client. This was previously
      // proxied through /api/geocode for rate limiting; that server-side
      // throttling should be reinstated as an Edge Function before launch.
      const url =
        "https://nominatim.openstreetmap.org/search?" +
        "q=" + encodeURIComponent(q) +
        "&format=json&limit=1";
      fetch(url, { headers: { "Accept-Language": "en" } })
        .then(async (r) => {
          if (cancelled) return;
          if (!r.ok) {
            setGeocodeState("error");
            return;
          }
          const data = (await r.json()) as Array<{ lat: string; lon: string }>;
          if (!data.length) {
            setGeocodeState("not_found");
            return;
          }
          setEventLat(parseFloat(data[0].lat));
          setEventLng(parseFloat(data[0].lon));
          setGeocodeState("ok");
        })
        .catch(() => {
          if (!cancelled) setGeocodeState("error");
        });
      return () => {
        cancelled = true;
      };
    }, 600);
    return () => clearTimeout(handle);
  }, [venueAddress, visibility]);

  async function useCurrentLocation() {
    setLocatingMe(true);
    const pos = await getCurrentPosition();
    setLocatingMe(false);
    if (isPositionError(pos)) {
      setError(
        pos.code === "unsupported"
          ? "Your browser doesn't support location lookup. Type an address instead."
          : "Couldn't read your location. Type an address instead."
      );
      return;
    }
    setEventLat(pos.latitude);
    setEventLng(pos.longitude);
    setGeocodeState("ok");
  }

  const publicReady =
    visibility === "public" && eventLat != null && eventLng != null;
  const groupReady = visibility === "group" && !!hostGroupId;
  const visibilityReady = publicReady || groupReady;

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
    if (visibility === "public" && (eventLat == null || eventLng == null)) {
      setError("Set a location — use your current location or enter an address.");
      return;
    }
    if (visibility === "group" && !hostGroupId) {
      setError("Pick which group will see this event.");
      return;
    }
    setSubmitting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const created = await createEvent(supabase, {
        title: title.trim(),
        description: description.trim(),
        event_type: type,
        start_date: new Date(startDate).toISOString(),
        end_date: new Date(endDate).toISOString(),
        signup_deadline: signupDeadline ? new Date(signupDeadline).toISOString() : null,
        venue_name: venueName.trim(),
        venue_address: venueAddress.trim(),
        max_participants: maxParticipants ? Number(maxParticipants) : null,
        ntrp_min: ntrpMin ? Number(ntrpMin) : null,
        ntrp_max: ntrpMax ? Number(ntrpMax) : null,
        visibility,
        event_lat: visibility === "public" ? eventLat : null,
        event_lng: visibility === "public" ? eventLng : null,
        radius_mi: visibility === "public" ? radiusMi : null,
        host_group_id: visibility === "group" ? hostGroupId : null,
      });
      // postToFeed (cross-post to feed) is a follow-up: the event-creating
      // post used to be inserted by the route handler. Could be reinstated
      // via a Postgres trigger or done client-side here when needed.
      void postToFeed;
      router.push(`/events/${created.id}`);
    } catch (err) {
      setError(errorMessage(err, "Couldn't create the event. Try again."));
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Start">
              <input
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="block w-full min-w-0 max-w-full appearance-none bg-white px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-court-green/30 focus:border-court-green text-sm"
                required
              />
            </Field>
            <Field label="End">
              <input
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="block w-full min-w-0 max-w-full appearance-none bg-white px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-court-green/30 focus:border-court-green text-sm"
                required
              />
            </Field>
          </div>
          <Field label="Signup deadline (optional)">
            <input
              type="datetime-local"
              value={signupDeadline}
              onChange={(e) => setSignupDeadline(e.target.value)}
              className="block w-full min-w-0 max-w-full appearance-none bg-white px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-court-green/30 focus:border-court-green text-sm"
            />
          </Field>
        </section>

        <section className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
          <div>
            <div className="block text-sm font-semibold text-gray-700 mb-2">Who can see this event</div>
            <div className="grid grid-cols-2 gap-2">
              <VisOption
                selected={visibility === "public"}
                onSelect={() => setVisibility("public")}
                title="Public"
                blurb="Anyone within your chosen radius can see and sign up."
                icon="🌎"
              />
              <VisOption
                selected={visibility === "group"}
                onSelect={() => setVisibility("group")}
                title="Group"
                blurb="Only members of a group you pick will see this event."
                icon="🔒"
              />
            </div>
          </div>

          {visibility === "public" && (
            <div className="space-y-3 pt-1">
              <div>
                <div className="block text-sm font-semibold text-gray-700 mb-1">Location anchor</div>
                <div className="flex items-center gap-2 mb-2">
                  <button
                    type="button"
                    onClick={useCurrentLocation}
                    disabled={locatingMe}
                    className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {locatingMe ? "Locating…" : "Use my current location"}
                  </button>
                  {eventLat != null && eventLng != null && (
                    <span className="text-[11px] text-gray-500">
                      {eventLat.toFixed(4)}, {eventLng.toFixed(4)}
                    </span>
                  )}
                </div>
                <Field label="Venue address (geocoded)">
                  <input
                    value={venueAddress}
                    onChange={(e) => setVenueAddress(e.target.value)}
                    placeholder="2000 Martin Luther King Jr Way S, Seattle"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-court-green/30 focus:border-court-green text-sm"
                  />
                </Field>
                <div className="text-[11px] mt-1 h-4">
                  {geocodeState === "loading" && <span className="text-gray-500">Looking up address…</span>}
                  {geocodeState === "ok" && <span className="text-court-green">Location set ✓</span>}
                  {geocodeState === "not_found" && (
                    <span className="text-amber-600">Couldn&apos;t geocode that address — try a more specific one.</span>
                  )}
                  {geocodeState === "error" && (
                    <span className="text-red-600">Geocoder error — try again or use current location.</span>
                  )}
                </div>
              </div>

              <Field label="Visible within">
                <div className="flex items-center gap-2">
                  {RADII.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRadiusMi(r)}
                      className={`px-3 py-1.5 rounded-lg border text-sm ${
                        radiusMi === r
                          ? "border-court-green bg-court-green/10 text-court-green font-semibold"
                          : "border-gray-200 text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {r} mi
                    </button>
                  ))}
                </div>
              </Field>

              <label className="flex items-start gap-3 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={postToFeed}
                  onChange={(e) => setPostToFeed(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded accent-court-green"
                />
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-gray-700">Cross-post to feed</span>
                  <span className="block text-[12px] text-gray-500 mt-0.5">
                    Share an event card in the main feed so eligible players spot it sooner.
                  </span>
                </span>
              </label>
            </div>
          )}

          {visibility === "group" && (
            <div className="space-y-2 pt-1">
              <Field label="Host group">
                {groupsLoading ? (
                  <div className="text-sm text-gray-500 py-2">Loading your groups…</div>
                ) : groups.length === 0 ? (
                  <div className="text-sm text-gray-500 py-2">
                    You&apos;re not in any groups yet.{" "}
                    <a className="text-court-green underline" href="/groups">Create one</a>.
                  </div>
                ) : (
                  <select
                    value={hostGroupId}
                    onChange={(e) => setHostGroupId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-court-green/30 focus:border-court-green text-sm bg-white"
                  >
                    <option value="">Pick a group…</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                )}
              </Field>
              <p className="text-[12px] text-gray-500">
                Only members of this group will see the event. Group events can&apos;t be cross-posted to the public feed.
              </p>
            </div>
          )}
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

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting || !visibilityReady}
            className="btn-primary"
          >
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

function VisOption({
  selected,
  onSelect,
  title,
  blurb,
  icon,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  blurb: string;
  icon: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left p-3 rounded-xl border-2 transition-all ${
        selected
          ? "border-court-green bg-court-green/5"
          : "border-gray-200 hover:border-gray-300 bg-white"
      }`}
    >
      <div className="text-xl mb-1">{icon}</div>
      <div className="font-semibold text-sm text-gray-900">{title}</div>
      <div className="text-[11px] text-gray-500 leading-snug mt-0.5">{blurb}</div>
    </button>
  );
}
