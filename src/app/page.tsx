"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import PostComposer from "@/components/PostComposer";
import PostCard from "@/components/PostCard";

const SEEN_KEY = "tennisfriend_seen_posts";

type Post = {
  id: string;
  content: string;
  mediaUrl?: string;
  mediaType?: string;
  postType?: string;
  playDate?: string;
  playTime?: string;
  courtLocation?: string;
  gameType?: string;
  playersNeeded?: number;
  playersConfirmed?: number;
  courtBooked?: boolean;
  isComplete?: boolean;
  isBroadcast?: boolean;
  broadcastRadiusMi?: number;
  distanceMiles?: number | null;
  pendingRequestCount?: number;
  myPlayRequest?: { id: string; status: string; note: string } | null;
  createdAt: string;
  author: { id: string; name: string; profileImageUrl: string };
  likeCount: number;
  isLiked: boolean;
  groups?: { id: string; name: string }[];
  friendGroups?: { id: string; name: string }[];
};

export default function HomePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetPostId = searchParams.get("post");
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [highlightedPostId, setHighlightedPostId] = useState<string | null>(null);
  // null = show all categories; otherwise show only the selected category
  const [activeFilter, setActiveFilter] = useState<"find_players" | "propose_team" | "social" | "nearby" | null>(null);

  // Lazy-checked once when the user first opens the Nearby filter. Null = unknown.
  const [hasLocation, setHasLocation] = useState<boolean | null>(null);
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [confirmingTurnOff, setConfirmingTurnOff] = useState(false);

  // Pull-to-refresh state
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const pullStartY = useRef(0);
  const isPulling = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const PULL_THRESHOLD = 80;

  const refreshFeed = useCallback(async () => {
    setRefreshing(true);
    setActiveFilter(null);
    try {
      const res = await fetch("/api/posts");
      const data = await res.json();
      setPosts(data);
    } finally {
      setRefreshing(false);
      setPullDistance(0);
    }
  }, []);

  // Pull-to-refresh touch handlers
  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      if (window.scrollY <= 0 && !refreshing) {
        pullStartY.current = e.touches[0].clientY;
        isPulling.current = true;
      }
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (!isPulling.current || refreshing) return;
      const delta = e.touches[0].clientY - pullStartY.current;
      if (delta > 0 && window.scrollY <= 0) {
        // Apply resistance: the further you pull, the harder it gets
        const dampened = Math.min(delta * 0.4, 120);
        setPullDistance(dampened);
      } else {
        setPullDistance(0);
      }
    };
    const handleTouchEnd = () => {
      if (!isPulling.current || refreshing) return;
      isPulling.current = false;
      if (pullDistance >= PULL_THRESHOLD) {
        refreshFeed();
      } else {
        setPullDistance(0);
      }
    };
    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: true });
    document.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [refreshing, refreshFeed, pullDistance]);

  // Track which posts the user has scrolled past (unread tracking)
  const [seenIds, setSeenIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = localStorage.getItem(SEEN_KEY);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Persist seen IDs to localStorage (capped at 500 to prevent bloat)
  useEffect(() => {
    const arr = [...seenIds];
    const capped = arr.length > 500 ? arr.slice(arr.length - 500) : arr;
    localStorage.setItem(SEEN_KEY, JSON.stringify(capped));
  }, [seenIds]);

  // IntersectionObserver: marks posts as "seen" when 50% visible
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const newlySeen: string[] = [];
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const postId = (entry.target as HTMLElement).dataset.postId;
            if (postId) newlySeen.push(postId);
          }
        }
        if (newlySeen.length > 0) {
          setSeenIds((prev) => {
            const next = new Set(prev);
            let changed = false;
            for (const id of newlySeen) {
              if (!next.has(id)) { next.add(id); changed = true; }
            }
            return changed ? next : prev;
          });
        }
      },
      { threshold: 0.5 }
    );
    return () => observerRef.current?.disconnect();
  }, []);

  // Callback ref for observing post elements
  const observePost = useCallback((el: HTMLDivElement | null) => {
    if (el && observerRef.current) observerRef.current.observe(el);
  }, []);

  const toggleFilter = (key: "find_players" | "propose_team" | "social" | "nearby") => {
    setActiveFilter(activeFilter === key ? null : key);
  };

  // Chip "active" state — only highlights the currently selected filter
  const filters = {
    has: (k: "find_players" | "propose_team" | "social" | "nearby") => activeFilter === k,
  };

  useEffect(() => {
    if (status === "authenticated") {
      fetch("/api/posts")
        .then((r) => r.json())
        .then((data) => {
          setPosts(data);
          setLoading(false);
        });
    }
  }, [status]);

  // First time the user activates the Nearby filter, check whether they have
  // location set. Needed to decide between showing broadcasts and showing the
  // "Add your location" empty-state banner.
  useEffect(() => {
    if (activeFilter !== "nearby" || hasLocation !== null) return;
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setHasLocation(!!(data?.latitude != null && data?.longitude != null));
      })
      .catch(() => setHasLocation(false));
  }, [activeFilter, hasLocation]);

  const turnOffLocation = async () => {
    setLocationError("");
    setLocationSaving(true);
    try {
      const res = await fetch("/api/profile/location", { method: "DELETE" });
      if (res.ok) {
        setHasLocation(false);
        setConfirmingTurnOff(false);
        // Refetch feed: the viewer's broadcasts (and broadcasts from others
        // requiring viewer lat/lng) should drop out of the response.
        const feedRes = await fetch("/api/posts");
        if (feedRes.ok) setPosts(await feedRes.json());
      } else {
        setLocationError("Could not turn off location.");
      }
    } catch {
      setLocationError("Could not turn off location.");
    }
    setLocationSaving(false);
  };

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
            body: JSON.stringify({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
          });
          if (res.ok) {
            setHasLocation(true);
            // Re-fetch the home feed so broadcasts (which require viewer lat/lng
            // server-side) start appearing without a page reload.
            const feedRes = await fetch("/api/posts");
            if (feedRes.ok) setPosts(await feedRes.json());
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

  // Scroll to + highlight a post when linked via ?post=<id> (e.g. from calendar)
  useEffect(() => {
    if (!targetPostId || loading) return;
    if (!posts.some((p) => p.id === targetPostId)) return;
    setActiveFilter(null);
    const scroll = () => {
      const el = document.querySelector(`[data-post-id="${targetPostId}"]`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightedPostId(targetPostId);
        setTimeout(() => setHighlightedPostId(null), 2000);
      }
    };
    const t = setTimeout(scroll, 50);
    return () => clearTimeout(t);
  }, [targetPostId, loading, posts]);

  if (status === "unauthenticated") {
    return <LandingPage />;
  }

  if (status === "loading") {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="skeleton w-10 h-10 rounded-full" />
                <div className="space-y-2">
                  <div className="skeleton w-32 h-4" />
                  <div className="skeleton w-20 h-3" />
                </div>
              </div>
              <div className="skeleton w-full h-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollContainerRef} className="max-w-2xl mx-auto px-4 py-8">
      {/* Pull-to-refresh indicator */}
      <div
        className="flex justify-center items-center overflow-hidden transition-all duration-300 ease-out"
        style={{
          height: refreshing ? 48 : pullDistance > 0 ? pullDistance : 0,
          opacity: refreshing ? 1 : Math.min(pullDistance / PULL_THRESHOLD, 1),
        }}
      >
        <div
          className={`w-8 h-8 rounded-full border-2 border-court-green flex items-center justify-center ${refreshing ? "animate-spin border-t-transparent" : ""}`}
          style={!refreshing ? {
            transform: `rotate(${pullDistance * 3}deg)`,
            transition: pullDistance === 0 ? "transform 0.3s ease-out" : "none",
          } : undefined}
        >
          {!refreshing && (
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className="text-court-green"
              style={{
                transform: pullDistance >= PULL_THRESHOLD ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s ease",
              }}
            >
              <polyline points="6,9 12,15 18,9" />
            </svg>
          )}
        </div>
      </div>
      <div className="space-y-5">
        <div className="animate-fade-in-up stagger-1">
          <PostComposer onPost={(post) => setPosts((prev) => [post as Post, ...prev])} />
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-2 flex-wrap animate-fade-in-up stagger-2">
          <span className="text-gray-400 flex items-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22,3 2,3 10,12.46 10,19 14,21 14,12.46" />
            </svg>
          </span>
          <button
            onClick={() => toggleFilter("social")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
              filters.has("social")
                ? "bg-court-green-soft text-white border-court-green-soft shadow-sm"
                : "bg-white text-gray-500 border-gray-200 hover:border-court-green-pale"
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21,15 16,10 5,21" />
            </svg>
            Social
          </button>
          <button
            onClick={() => toggleFilter("find_players")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
              filters.has("find_players")
                ? "bg-court-green text-white border-court-green shadow-sm"
                : "bg-white text-gray-500 border-gray-200 hover:border-court-green-pale"
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            Find Players
          </button>
          <button
            onClick={() => toggleFilter("propose_team")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
              filters.has("propose_team")
                ? "bg-clay text-white border-clay shadow-sm"
                : "bg-white text-gray-500 border-gray-200 hover:border-clay/50"
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9H4.5a2.5 2.5 0 010-5H6" />
              <path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
              <path d="M4 22h16" />
              <path d="M18 2H6v7a6 6 0 0012 0V2z" />
            </svg>
            Teams
          </button>
          <button
            onClick={() => toggleFilter("nearby")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
              filters.has("nearby")
                ? "bg-ball-yellow text-court-green border-ball-yellow shadow-sm"
                : "bg-white text-gray-500 border-gray-200 hover:border-ball-yellow"
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11a9 9 0 0118 0" />
              <path d="M6.5 11a5.5 5.5 0 0111 0" />
              <circle cx="12" cy="11" r="1.5" fill="currentColor" />
              <path d="M12 13v7" />
            </svg>
            Nearby
          </button>
        </div>

        {/* Inline turn-off control: only visible when viewing Nearby broadcasts
            with location set. Mirrors the per-context affordance we previously
            had on the dedicated /nearby page. */}
        {activeFilter === "nearby" && hasLocation === true && (
          <div className="flex flex-wrap items-center gap-2 text-xs -mt-2">
            <span className="inline-flex items-center gap-1.5 text-gray-500">
              <span className="w-1.5 h-1.5 rounded-full bg-court-green" />
              Location on
            </span>
            {confirmingTurnOff ? (
              <>
                <span className="text-gray-400">·</span>
                <span className="text-gray-600">Turn off? Active broadcasts will be disabled.</span>
                <button
                  onClick={turnOffLocation}
                  disabled={locationSaving}
                  className="font-semibold text-red-600 hover:underline disabled:opacity-60"
                >
                  {locationSaving ? "..." : "Confirm"}
                </button>
                <button
                  onClick={() => setConfirmingTurnOff(false)}
                  disabled={locationSaving}
                  className="text-gray-500 hover:underline"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className="text-gray-400">·</span>
                <button
                  onClick={() => setConfirmingTurnOff(true)}
                  className="font-semibold text-court-green hover:underline"
                >
                  Turn off
                </button>
              </>
            )}
            {locationError && (
              <span className="w-full text-red-500">{locationError}</span>
            )}
          </div>
        )}

        {/* Filtered posts */}
        {(() => {
          const filtered = posts.filter((p) => {
            if (activeFilter === null) return true;
            if (activeFilter === "find_players") return p.postType === "find_players";
            if (activeFilter === "propose_team") return p.postType === "propose_team";
            if (activeFilter === "nearby") {
              return p.isBroadcast === true && p.author.id !== session?.user?.id;
            }
            return p.postType !== "find_players" && p.postType !== "propose_team";
          });

          if (loading) {
            return (
              <div className="space-y-4">
                {[1, 2].map((i) => (
                  <div key={i} className="bg-white rounded-2xl p-6 shadow-sm">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="skeleton w-10 h-10 rounded-full" />
                      <div className="space-y-2">
                        <div className="skeleton w-32 h-4" />
                        <div className="skeleton w-20 h-3" />
                      </div>
                    </div>
                    <div className="skeleton w-full h-16" />
                  </div>
                ))}
              </div>
            );
          }

          if (activeFilter === "nearby" && hasLocation === false) {
            return (
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-orange-200 animate-fade-in-up">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center shrink-0">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-orange-500">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-800 mb-1">Add your location</p>
                    <p className="text-sm text-gray-500 mb-3">
                      Broadcasts are matched by distance. Share your location so we can find players nearby.
                    </p>
                    <button
                      onClick={useMyLocation}
                      disabled={locationSaving}
                      className="btn-primary text-sm disabled:opacity-60"
                    >
                      {locationSaving ? "Getting location…" : "Use my location"}
                    </button>
                    {locationError && (
                      <p className="text-xs text-red-500 mt-2">{locationError}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          }

          if (filtered.length === 0) {
            return (
              <div className="animate-fade-in-up text-center py-16 bg-white rounded-2xl shadow-sm border border-court-green-pale/20">
                <div className="w-16 h-16 bg-ball-yellow/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <div className="w-8 h-8 rounded-full bg-ball-yellow animate-ball-bounce" />
                </div>
                <h3 className="font-display text-xl font-bold text-gray-800 mb-2">
                  The court is quiet
                </h3>
                <p className="text-gray-500 text-sm max-w-xs mx-auto mb-6">
                  No posts match your filter. Try selecting more categories or create the first post!
                </p>
              </div>
            );
          }

          return filtered.map((post, i) => (
            <div
              key={post.id}
              data-post-id={post.id}
              ref={observePost}
              className={`animate-fade-in-up stagger-${Math.min(i + 1, 5)} rounded-2xl transition-shadow ${highlightedPostId === post.id ? "ring-2 ring-court-green ring-offset-2" : ""}`}
            >
              <PostCard
                post={post}
                onDelete={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
                onUpdate={(id, updates) => setPosts((prev) => prev.map((p) => p.id === id ? { ...p, ...updates } : p))}
              />
            </div>
          ));
        })()}
      </div>
    </div>
  );
}

function LandingPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col">
      <div className="flex-1 flex items-center justify-center px-4 py-20 relative overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-court-green/5 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-ball-yellow/10 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] border border-court-green/5 rounded-full" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] border border-court-green/5 rounded-full" />
        </div>

        <div className="text-center max-w-2xl mx-auto">
          <div className="mb-8 flex justify-center">
            <div className="w-20 h-20 rounded-full bg-ball-yellow shadow-2xl shadow-ball-yellow/30 animate-ball-bounce flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-10 h-10 text-court-green/40" fill="none" stroke="currentColor" strokeWidth="1">
                <path d="M7 4.5c1.5 2 2.5 5 2.5 7.5s-1 5.5-2.5 7.5M17 4.5c-1.5 2-2.5 5-2.5 7.5s1 5.5 2.5 7.5" />
              </svg>
            </div>
          </div>

          <h1 className="font-display text-5xl sm:text-6xl font-bold text-court-green mb-4 animate-fade-in-up">
            Tennis<span className="text-ball-yellow">Friends</span>
          </h1>

          <p className="text-xl text-gray-600 mb-3 animate-fade-in-up stagger-1 max-w-md mx-auto leading-relaxed">
            The social network for tennis lovers.
          </p>
          <p className="text-gray-400 mb-10 animate-fade-in-up stagger-2 text-sm">
            Connect with players, find partners, and share your tennis journey.
          </p>

          <div className="flex items-center justify-center gap-4 animate-fade-in-up stagger-3">
            <Link href="/register" className="btn-primary px-8 py-3.5 text-base shadow-xl shadow-court-green/20">
              Join the Club
            </Link>
            <Link href="/login" className="btn-secondary px-8 py-3.5 text-base">
              Sign In
            </Link>
          </div>

          <div className="mt-16 grid grid-cols-3 gap-8 animate-fade-in-up stagger-4">
            {[
              { label: "Players", value: "Connect" },
              { label: "Matches", value: "Play" },
              { label: "Stories", value: "Share" },
            ].map((stat) => (
              <div key={stat.label}>
                <div className="font-display text-2xl font-bold text-court-green">
                  {stat.value}
                </div>
                <div className="text-sm text-gray-400 mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
