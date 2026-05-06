"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import FriendRequestButton from "@/components/FriendRequestButton";
import { looksLikeEmail, looksLikePhone, normalizeE164 } from "@/lib/phone";
import { AGE_LABELS, GENDER_LABELS, formatRating } from "@/lib/profileLabels";

type Bucket = "beginner" | "intermediate" | "advanced" | "pro";
type AgeKey = "under_18" | "18_29" | "30_49" | "50_plus";
type GenderKey = "male" | "female" | "non_binary" | "prefer_not_to_say";
type SortKey = "distance" | "recent";

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
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
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

  // Viewer's location state — drives the location consent banner.
  const [hasLocation, setHasLocation] = useState<boolean | null>(null); // null = unknown
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [locationDismissed, setLocationDismissed] = useState(false);

  // On mount, fetch /api/profile to know if the viewer already has lat/lng.
  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data) => {
        const has = data?.latitude != null && data?.longitude != null;
        setHasLocation(has);
        if (!has) setSort("recent");
      })
      .catch(() => setHasLocation(false));
  }, []);

  const search = useCallback(async (raw: string) => {
    const trimmed = raw.trim();
    setLoading(true);
    const params = new URLSearchParams();
    if (looksLikeEmail(trimmed)) {
      params.set("email", trimmed);
    } else if (looksLikePhone(trimmed)) {
      const e164 = normalizeE164(trimmed);
      if (!e164) {
        setResults([]);
        setLoading(false);
        setSearched(true);
        return;
      }
      params.set("phone", e164);
    } else if (trimmed) {
      params.set("q", trimmed);
    }
    if (buckets.size > 0) params.set("bucket", Array.from(buckets).join(","));
    if (ages.size > 0) params.set("ageRange", Array.from(ages).join(","));
    if (genders.size > 0) params.set("gender", Array.from(genders).join(","));
    if (tagFilter.trim()) params.set("tag", tagFilter.trim());
    params.set("sort", sort);

    const res = await fetch(`/api/users?${params.toString()}`);
    const data = await res.json();
    setResults(Array.isArray(data) ? data : []);
    setLoading(false);
    setSearched(true);
  }, [buckets, ages, genders, tagFilter, sort]);

  // Debounced fetch on any input change.
  useEffect(() => {
    const timer = setTimeout(() => {
      search(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setLocationError("Your browser doesn't support geolocation.");
      return;
    }
    setLocationError("");
    setLocationSaving(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch("/api/profile", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            }),
          });
          if (res.ok) {
            setHasLocation(true);
            setSort("distance");
          } else {
            setLocationError("Could not save location.");
          }
        } catch {
          setLocationError("Could not save location.");
        }
        setLocationSaving(false);
      },
      (err) => {
        setLocationSaving(false);
        if (err.code === err.PERMISSION_DENIED) setLocationError("Location permission denied.");
        else setLocationError("Could not get your location.");
      },
      { timeout: 10000, maximumAge: 60_000 }
    );
  };

  const toggle = <T,>(set: Set<T>, val: T): Set<T> => {
    const next = new Set(set);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    return next;
  };

  const hasFilters =
    buckets.size > 0 || ages.size > 0 || genders.size > 0 || tagFilter.trim().length > 0;

  const clearFilters = () => {
    setBuckets(new Set());
    setAges(new Set());
    setGenders(new Set());
    setTagFilter("");
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
          onChange={(e) => setQuery(e.target.value)}
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
              onClick={() => setBuckets(toggle(buckets, opt.value))}
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
              onClick={() => setAges(toggle(ages, opt.value))}
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
              onClick={() => setGenders(toggle(genders, opt.value))}
            >
              {opt.label}
            </FilterChip>
          ))}
        </FilterRow>
        <div className="flex items-center gap-2 pt-1">
          <input
            type="text"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
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
          {results.length} {results.length === 1 ? "player" : "players"}
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
        {!loading && searched && results.length === 0 ? (
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
          results.map((user) => (
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
