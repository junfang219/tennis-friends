"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import PostComposer from "@/components/PostComposer";
import PostCard from "@/components/PostCard";

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
  pendingRequestCount?: number;
  myPlayRequest?: { id: string; status: string; note: string } | null;
  createdAt: string;
  author: { id: string; name: string; profileImageUrl: string };
  likeCount: number;
  isLiked: boolean;
  groups?: { id: string; name: string }[];
};

export default function HomePage() {
  const { data: session, status } = useSession();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"find_players" | "propose_team" | "social">("find_players");

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
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="animate-fade-in-up">
        <h2 className="font-display text-2xl font-bold text-court-green mb-1">
          Your Court
        </h2>
        <p className="text-gray-500 text-sm mb-6">
          What&apos;s happening in your tennis world, {session?.user?.name?.split(" ")[0]}?
        </p>
      </div>

      <div className="space-y-5">
        <div className="animate-fade-in-up stagger-1">
          <PostComposer onPost={(post) => setPosts([post as Post, ...posts])} />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-white rounded-2xl p-1.5 shadow-sm border border-court-green-pale/20 animate-fade-in-up stagger-2">
          <button
            onClick={() => setTab("find_players")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              tab === "find_players"
                ? "bg-court-green text-white shadow-md"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={tab === "find_players" ? 2.5 : 2} strokeLinecap="round">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            Find Players
            {!loading && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${tab === "find_players" ? "bg-white/20 text-white" : "bg-ball-yellow text-court-green"}`}>
                {posts.filter((p) => p.postType === "find_players" && !p.isComplete).length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("propose_team")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              tab === "propose_team"
                ? "bg-clay text-white shadow-md"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={tab === "propose_team" ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9H4.5a2.5 2.5 0 010-5H6" />
              <path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
              <path d="M4 22h16" />
              <path d="M18 2H6v7a6 6 0 0012 0V2z" />
            </svg>
            Teams
            {!loading && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${tab === "propose_team" ? "bg-white/20 text-white" : "bg-clay/20 text-clay"}`}>
                {posts.filter((p) => p.postType === "propose_team" && !p.isComplete).length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("social")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              tab === "social"
                ? "bg-court-green text-white shadow-md"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={tab === "social" ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21,15 16,10 5,21" />
            </svg>
            Social
            {!loading && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${tab === "social" ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"}`}>
                {posts.filter((p) => p.postType !== "find_players" && p.postType !== "propose_team").length}
              </span>
            )}
          </button>
        </div>

        {/* Filtered posts */}
        {(() => {
          const filtered = posts.filter((p) =>
            tab === "find_players" ? p.postType === "find_players"
            : tab === "propose_team" ? p.postType === "propose_team"
            : (p.postType !== "find_players" && p.postType !== "propose_team")
          );

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

          if (filtered.length === 0) {
            return (
              <div className="animate-fade-in-up text-center py-16 bg-white rounded-2xl shadow-sm border border-court-green-pale/20">
                <div className="w-16 h-16 bg-ball-yellow/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  {tab === "find_players" ? (
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-court-green-soft" strokeLinecap="round">
                      <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                    </svg>
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-ball-yellow animate-ball-bounce" />
                  )}
                </div>
                <h3 className="font-display text-xl font-bold text-gray-800 mb-2">
                  {tab === "find_players" ? "No games posted yet" :
                   tab === "propose_team" ? "No teams being proposed" :
                   "The court is quiet"}
                </h3>
                <p className="text-gray-500 text-sm max-w-xs mx-auto mb-6">
                  {tab === "find_players" ? "Create a Find Players post to organize a game!" :
                   tab === "propose_team" ? "Propose a team to recruit interested players!" :
                   "Share photos, videos, and updates with your tennis friends."}
                </p>
              </div>
            );
          }

          return filtered.map((post, i) => (
            <div key={post.id} className={`animate-fade-in-up stagger-${Math.min(i + 1, 5)}`}>
              <PostCard
                post={post}
                onDelete={(id) => setPosts(posts.filter(p => p.id !== id))}
                onUpdate={(id, updates) => setPosts(posts.map(p => p.id === id ? { ...p, ...updates } : p))}
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
