"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import FriendRequestButton from "@/components/FriendRequestButton";

type UserResult = {
  id: string;
  name: string;
  skillLevel: string;
  favoriteSurface: string;
  profileImageUrl: string;
  bio: string;
  friendshipId: string | null;
  friendshipStatus: string | null;
  isRequester: boolean;
};

const SKILL_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  professional: "Professional",
};

const SURFACE_LABELS: Record<string, string> = {
  hard: "Hard Court",
  clay: "Clay",
  grass: "Grass",
  indoor: "Indoor",
};

const SURFACE_COLORS: Record<string, string> = {
  hard: "bg-blue-50 text-blue-600",
  clay: "bg-orange-50 text-orange-600",
  grass: "bg-green-50 text-green-600",
  indoor: "bg-purple-50 text-purple-600",
};

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = useCallback(async (q: string) => {
    setLoading(true);
    const res = await fetch(`/api/users?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setResults(data);
    setLoading(false);
    setSearched(true);
  }, []);

  // Load all users on mount + debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      search(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="animate-fade-in-up">
        <h1 className="font-display text-2xl font-bold text-court-green mb-1">
          Discover Players
        </h1>
        <p className="text-gray-500 text-sm mb-6">Find your next doubles partner or hitting buddy</p>
      </div>

      {/* Search input */}
      <div className="animate-fade-in-up stagger-1 relative mb-6">
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
          placeholder="Search by name..."
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

      {/* Results */}
      <div className="space-y-3">
        {!loading && searched && results.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-court-green-pale/20 animate-fade-in-up stagger-2">
            <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
              </svg>
            </div>
            <h3 className="font-display text-lg font-bold text-gray-800 mb-2">
              No players found
            </h3>
            <p className="text-gray-500 text-sm">
              {query ? `No results for "${query}". Try a different name.` : "No other players have joined yet."}
            </p>
          </div>
        ) : (
          results.map((user, i) => (
            <div
              key={user.id}
              className={`animate-fade-in-up stagger-${Math.min(i + 2, 5)} bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-5 flex items-center gap-4 card-hover`}
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
                {user.bio && (
                  <p className="text-xs text-gray-500 mt-0.5 truncate">{user.bio}</p>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs font-medium text-court-green bg-ball-yellow/20 px-2 py-0.5 rounded-full">
                    {SKILL_LABELS[user.skillLevel] || user.skillLevel}
                  </span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SURFACE_COLORS[user.favoriteSurface] || "bg-gray-50 text-gray-600"}`}>
                    {SURFACE_LABELS[user.favoriteSurface] || user.favoriteSurface}
                  </span>
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
