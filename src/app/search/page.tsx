"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import FriendRequestButton from "@/components/FriendRequestButton";
import { AGE_LABELS, GENDER_LABELS, formatRating } from "@/lib/profileLabels";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getMyProfile, searchProfiles, updateMyProfile } from "@/lib/supabase/queries";
import { getCurrentPosition, isPositionError } from "@/lib/getCurrentPosition";
import { rankPlayers } from "@/lib/discoverRanking";

type Bucket = "beginner" | "intermediate" | "advanced" | "pro";
type AgeKey = "under_18" | "18_29" | "30_49" | "50_plus";
type GenderKey = "male" | "female";
type SortKey = "distance" | "recent";

// How many recommendations to show before the "Show more" button. The cap only
// applies to the plain browse state; an active search or filter shows every
// match (see capActive below).
const DEFAULT_VISIBLE = 20;

const BUCKET_OPTIONS: { value: Bucket; label: string }[] = [
  { value: "beginner", label: "NTRP 2.5–3.0" },
  { value: "intermediate", label: "NTRP 3.0–4.0" },
  { value: "advanced", label: "NTRP 4.0–5.0" },
  { value: "pro", label: "NTRP 5.0+" },
];

const AGE_OPTIONS: { value: AgeKey; label: string }[] = [
  { value: "under_18", label: "Under 18" },
  { value: "18_29", label: "18–29" },
  { value: "30_49", label: "30–49" },
  { value: "50_plus", label: "50+" },
];

const GENDER_OPTIONS: { value: GenderKey; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

type UserResult = {
  id: string;
  name: string;
  skillLevel: string;
  favoriteSurface: string;
  profileImageUrl: string;
  bio: string;
  gender: string;
  ageRange: string;
  ratingSystem: string;
  ntrpRating: number | null;
  utrRating: number | null;
  handle: string | null;
  customTags: string[];
  latitude: number | null;
  longitude: number | null;
  updatedAt: string;
  distanceMiles: number | null;
  friendshipId: string | null;
  friendshipStatus: string | null;
  isRequester: boolean;
};

function formatDistance(miles: number): string {
  if (miles < 0.1) return "Right here";
  if (miles < 10) return `${miles.toFixed(1)} mi away`;
  return `${Math.round(miles)} mi away`;
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // Filters
  const [buckets, setBuckets] = useState<Set<Bucket>>(new Set());
  const [ages, setAges] = useState<Set<AgeKey>>(new Set());
  const [genders, setGenders] = useState<Set<GenderKey>>(new Set());
  const [tagFilter, setTagFilter] = useState("");

  // Sort
  const [sort, setSort] = useState<SortKey>("distance");

  // Whether the browse-state cap has been expanded via "Show more".
  const [showAll, setShowAll] = useState(false);

  // Viewer's location — drives the consent banner and is the origin point
  // for the distance ranking. We keep the coords (not just a boolean) so the
  // list can compute "X mi away" for every result client-side.
  const [myLoc, setMyLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [hasLocation, setHasLocation] = useState<boolean | null>(null); // null = unknown
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [locationDismissed, setLocationDismissed] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    getMyProfile(supabase)
      .then((p) => {
        const has = p?.latitude != null && p?.longitude != null;
        setHasLocation(has);
        if (has) setMyLoc({ lat: p!.latitude!, lng: p!.longitude! });
        else setSort("recent");
      })
      .catch(() => setHasLocation(false));
  }, []);

  // Fetches the candidate pool from the server using the filters Postgres can
  // do cheaply (NTRP / gender / age). Text search, tag match, distance, and
  // sort are all applied client-side in the `displayed` memo below — they
  // operate on data already in hand, so they stay instant and don't refetch.
  const search = useCallback(async () => {
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    // Map the UI's ntrp buckets to the searchProfiles range filter.
    let ntrpMin: number | undefined;
    let ntrpMax: number | undefined;
    if (buckets.has("beginner")) {
      ntrpMin = ntrpMin ?? 1.0;
      ntrpMax = Math.max(ntrpMax ?? 3.0, 3.0);
    }
    if (buckets.has("intermediate")) {
      ntrpMin = Math.min(ntrpMin ?? 3.0, 3.0);
      ntrpMax = Math.max(ntrpMax ?? 4.0, 4.0);
    }
    if (buckets.has("advanced")) {
      ntrpMin = Math.min(ntrpMin ?? 4.0, 4.0);
      ntrpMax = Math.max(ntrpMax ?? 5.0, 5.0);
    }
    if (buckets.has("pro")) {
      ntrpMin = Math.min(ntrpMin ?? 5.0, 5.0);
      ntrpMax = Math.max(ntrpMax ?? 7.0, 7.0);
    }
    const gender = genders.size === 1 ? Array.from(genders)[0] : undefined;
    const ageRange = ages.size === 1 ? Array.from(ages)[0] : undefined;
    try {
      const rows = await searchProfiles(supabase, {
        ntrpMin,
        ntrpMax,
        gender,
        ageRange,
        limit: 100,
      });
      // Coerce snake_case → the page's camelCase Result type.
      setResults(
        rows.map((p) => ({
          id: p.id,
          name: p.name,
          profileImageUrl: p.profile_image_url,
          bio: p.bio,
          skillLevel: p.skill_level,
          favoriteSurface: p.favorite_surface,
          gender: p.gender,
          ageRange: p.age_range,
          ratingSystem: p.rating_system,
          ntrpRating: p.ntrp_rating,
          utrRating: p.utr_rating,
          customTags: p.custom_tags ? p.custom_tags.split(",").filter(Boolean) : [],
          handle: p.handle,
          latitude: p.latitude,
          longitude: p.longitude,
          updatedAt: p.updated_at,
          distanceMiles: null,
          friendshipId: p.friendshipId,
          friendshipStatus: p.friendshipStatus,
          isRequester: p.isRequester,
        }))
      );
    } catch {
      setResults([]);
    }
    setLoading(false);
    setSearched(true);
  }, [buckets, ages, genders]);

  // Refetch when a server-side filter changes (debounced so rapid chip
  // toggling doesn't fire a request per click). Also runs once on mount.
  useEffect(() => {
    const timer = setTimeout(search, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Annotate with distance, apply text/tag filters, and sort. See
  // rankPlayers — all client-side over the already-fetched pool, so toggling
  // sort or typing is instant and never refetches.
  const displayed = useMemo(
    () => rankPlayers(results, { viewer: myLoc, sort, query, tag: tagFilter }),
    [results, myLoc, sort, query, tagFilter]
  );

  const useMyLocation = async () => {
    setLocationError("");
    setLocationSaving(true);
    const pos = await getCurrentPosition();
    if (isPositionError(pos)) {
      setLocationSaving(false);
      setLocationError(
        pos.code === "permission_denied"
          ? "Location permission denied."
          : pos.code === "unsupported"
            ? "Your browser doesn't support geolocation."
            : "Could not get your location."
      );
      return;
    }
    try {
      const supabase = createSupabaseBrowserClient();
      await updateMyProfile(supabase, { latitude: pos.latitude, longitude: pos.longitude });
      setMyLoc({ lat: pos.latitude, lng: pos.longitude });
      setHasLocation(true);
      setSort("distance");
    } catch {
      setLocationError("Could not save location.");
    }
    setLocationSaving(false);
  };

  const toggle = <T,>(set: Set<T>, val: T): Set<T> => {
    const next = new Set(set);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    return next;
  };

  const hasFilters =
    buckets.size > 0 || ages.size > 0 || genders.size > 0 || tagFilter.trim().length > 0;

  // The cap only applies to the plain browse state. Once the user types a
  // search or applies any filter they're looking for specific people, so we
  // show every match — a name match ranked beyond #20 must not be hidden.
  const capActive = !showAll && query.trim() === "" && !hasFilters;
  const visible = capActive ? displayed.slice(0, DEFAULT_VISIBLE) : displayed;
  const hiddenCount = displayed.length - visible.length;

  // Changing the search text or any filter re-collapses the list to the cap, so
  // returning to a clean browse shows the top 20 again rather than staying
  // expanded from an earlier "Show more". Goes through these handlers (not an
  // effect) to keep the reset out of render.
  const collapse = () => setShowAll(false);

  const clearFilters = () => {
    setBuckets(new Set());
    setAges(new Set());
    setGenders(new Set());
    setTagFilter("");
    collapse();
  };

  const showLocationBanner = hasLocation === false && !locationDismissed;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="animate-fade-in-up">
        <h1 className="font-display text-2xl font-bold text-court-green mb-1">
          Discover Players
        </h1>
        <p className="text-gray-500 text-sm mb-6">Find your next doubles partner or hitting buddy</p>
      </div>

      {showLocationBanner && (
        <div className="mb-4 rounded-2xl border border-court-green-pale/40 bg-court-green-pale/10 px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-court-green flex items-center justify-center text-ball-yellow shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-court-green">Find players near you</p>
            <p className="text-[11px] text-gray-500">
              {locationError || "Set your location to rank by distance."}
            </p>
          </div>
          <button
            onClick={useMyLocation}
            disabled={locationSaving}
            className="bg-court-green text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-court-green-light disabled:opacity-60"
          >
            {locationSaving ? "..." : "Use my location"}
          </button>
          <button
            onClick={() => setLocationDismissed(true)}
            className="text-gray-400 hover:text-gray-600 text-xs"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* Search input */}
      <div className="relative mb-4">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); collapse(); }}
          placeholder="Search by name, @handle, email, or phone"
          className="w-full pl-11 pr-4 py-3.5 border border-court-green-pale/30 rounded-2xl text-sm bg-white shadow-sm focus:shadow-md transition-shadow"
        />
        {loading && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2">
            <svg className="animate-spin w-4 h-4 text-court-green-soft" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
              <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-court-green-pale/20 shadow-sm p-3 mb-4 space-y-2">
        <FilterRow label="Skill">
          {BUCKET_OPTIONS.map((opt) => (
            <FilterChip
              key={opt.value}
              active={buckets.has(opt.value)}
              onClick={() => { setBuckets(toggle(buckets, opt.value)); collapse(); }}
            >
              {opt.label}
            </FilterChip>
          ))}
        </FilterRow>
        <FilterRow label="Age">
          {AGE_OPTIONS.map((opt) => (
            <FilterChip
              key={opt.value}
              active={ages.has(opt.value)}
              onClick={() => { setAges(toggle(ages, opt.value)); collapse(); }}
            >
              {opt.label}
            </FilterChip>
          ))}
        </FilterRow>
        <FilterRow label="Gender">
          {GENDER_OPTIONS.map((opt) => (
            <FilterChip
              key={opt.value}
              active={genders.has(opt.value)}
              onClick={() => { setGenders(toggle(genders, opt.value)); collapse(); }}
            >
              {opt.label}
            </FilterChip>
          ))}
        </FilterRow>
        <div className="flex items-center gap-2 pt-1">
          <input
            type="text"
            value={tagFilter}
            onChange={(e) => { setTagFilter(e.target.value); collapse(); }}
            placeholder="Filter by tag, e.g. Seattle"
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
            maxLength={30}
          />
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-xs font-semibold text-gray-500 hover:text-court-green px-2 py-1"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Sort toggle */}
      <div className="flex items-center justify-between mb-3 px-1">
        <p className="text-xs text-gray-500">
          {capActive && hiddenCount > 0
            ? `Showing ${visible.length} of ${displayed.length}`
            : `${displayed.length} ${displayed.length === 1 ? "player" : "players"}`}
        </p>
        <div className="inline-flex rounded-full bg-court-green-pale/15 p-0.5 text-[11px] font-bold">
          <button
            onClick={() => setSort("distance")}
            disabled={!hasLocation}
            className={`px-3 py-1 rounded-full transition-colors ${
              sort === "distance"
                ? "bg-court-green text-white shadow-sm"
                : "text-gray-500 hover:text-court-green disabled:opacity-50 disabled:cursor-not-allowed"
            }`}
            title={hasLocation ? "Sort by distance" : "Set your location to sort by distance"}
          >
            Distance
          </button>
          <button
            onClick={() => setSort("recent")}
            className={`px-3 py-1 rounded-full transition-colors ${
              sort === "recent"
                ? "bg-court-green text-white shadow-sm"
                : "text-gray-500 hover:text-court-green"
            }`}
          >
            Recent
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="space-y-3">
        {!loading && searched && displayed.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-court-green-pale/20">
            <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
              </svg>
            </div>
            <h3 className="font-display text-lg font-bold text-gray-800 mb-2">
              No players match
            </h3>
            <p className="text-gray-500 text-sm">
              {query
                ? `No results for "${query}". Try clearing filters.`
                : hasFilters
                ? "Try removing some filters."
                : "No other players have joined yet."}
            </p>
          </div>
        ) : (
          visible.map((user) => (
            <div
              key={user.id}
              className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-5 flex items-center gap-4 card-hover"
            >
              <Link href={`/profile/${user.id}`}>
                <Avatar name={user.name} image={user.profileImageUrl} size="lg" />
              </Link>
              <div className="flex-1 min-w-0">
                <Link
                  href={`/profile/${user.id}`}
                  className="font-semibold text-gray-900 hover:text-court-green transition-colors text-sm"
                >
                  {user.name}
                </Link>
                {user.handle && (
                  <p className="text-xs text-gray-500 font-medium">@{user.handle}</p>
                )}
                {user.distanceMiles != null && (
                  <p className="text-[11px] text-court-green-light font-medium mt-0.5">
                    {formatDistance(user.distanceMiles)}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {formatRating(user) && (
                    <span className="text-xs font-medium text-court-green bg-ball-yellow/20 px-2 py-0.5 rounded-full">
                      {formatRating(user)}
                    </span>
                  )}
                  {user.ageRange && (
                    <span className="text-xs font-medium text-gray-700 bg-gray-100 px-2 py-0.5 rounded-full">
                      {AGE_LABELS[user.ageRange] || user.ageRange}
                    </span>
                  )}
                  {user.gender && (
                    <span className="text-xs font-medium text-gray-700 bg-gray-100 px-2 py-0.5 rounded-full">
                      {GENDER_LABELS[user.gender] || user.gender}
                    </span>
                  )}
                  {(user.customTags || []).map((tag) => (
                    <span key={tag} className="text-xs font-medium text-court-green-light bg-court-green-pale/15 px-2 py-0.5 rounded-full">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <FriendRequestButton
                userId={user.id}
                initial={{
                  friendshipId: user.friendshipId,
                  friendshipStatus: user.friendshipStatus,
                  isRequester: user.isRequester,
                }}
              />
            </div>
          ))
        )}

        {capActive && hiddenCount > 0 && (
          <button
            onClick={() => setShowAll(true)}
            className="w-full bg-white rounded-2xl shadow-sm border border-court-green-pale/20 py-3.5 text-sm font-bold text-court-green hover:bg-court-green-pale/10 transition-colors"
          >
            Show {hiddenCount} more
          </button>
        )}
      </div>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 w-14 shrink-0">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${
        active
          ? "bg-court-green text-white shadow-sm"
          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
      }`}
    >
      {children}
    </button>
  );
}
