"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Avatar from "@/components/Avatar";

type FriendUser = { id: string; name: string; profileImageUrl: string; skillLevel: string };

type FriendEntry = {
  friendshipId: string;
  user: FriendUser;
};

type FriendsData = {
  friends: FriendEntry[];
  incomingRequests: FriendEntry[];
  outgoingRequests: FriendEntry[];
};

const SKILL_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  professional: "Professional",
};

export default function FriendsPage() {
  const [data, setData] = useState<FriendsData | null>(null);
  const [tab, setTab] = useState<"friends" | "incoming" | "outgoing">("friends");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadFriends = () => {
    fetch("/api/friends").then((r) => r.json()).then(setData);
  };

  useEffect(() => {
    loadFriends();
  }, []);

  const acceptRequest = async (friendshipId: string) => {
    setActionLoading(friendshipId);
    await fetch("/api/friends/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ friendshipId }),
    });
    loadFriends();
    setActionLoading(null);
  };

  const rejectRequest = async (friendshipId: string) => {
    setActionLoading(friendshipId);
    await fetch("/api/friends/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ friendshipId }),
    });
    loadFriends();
    setActionLoading(null);
  };

  const removeFriend = async (friendshipId: string) => {
    setActionLoading(friendshipId);
    await fetch("/api/friends/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ friendshipId }),
    });
    loadFriends();
    setActionLoading(null);
  };

  if (!data) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl p-5 shadow-sm flex items-center gap-4">
              <div className="skeleton w-12 h-12 rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="skeleton w-36 h-4" />
                <div className="skeleton w-24 h-3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const tabs = [
    { key: "friends" as const, label: "Friends", count: data.friends.length },
    { key: "incoming" as const, label: "Incoming", count: data.incomingRequests.length },
    { key: "outgoing" as const, label: "Sent", count: data.outgoingRequests.length },
  ];

  const friendsList =
    tab === "friends"
      ? data.friends
      : tab === "incoming"
      ? data.incomingRequests
      : data.outgoingRequests;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="animate-fade-in-up">
        <h1 className="font-display text-2xl font-bold text-court-green mb-1">
          Your Network
        </h1>
        <p className="text-gray-500 text-sm mb-6">Manage your tennis connections</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white rounded-2xl p-1.5 shadow-sm border border-court-green-pale/20 mb-6 animate-fade-in-up stagger-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              tab === t.key
                ? "bg-court-green text-white shadow-md"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  tab === t.key
                    ? "bg-white/20 text-white"
                    : t.key === "incoming"
                    ? "bg-ball-yellow text-court-green"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Friends / Incoming / Outgoing list */}
      <div className="space-y-3">
          {friendsList.length === 0 ? (
            <div className="animate-fade-in-up stagger-2 text-center py-16 bg-white rounded-2xl shadow-sm border border-court-green-pale/20">
              <div className="w-14 h-14 bg-court-green-pale/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-court-green-soft">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" strokeLinecap="round" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round" />
                </svg>
              </div>
              <h3 className="font-display text-lg font-bold text-gray-800 mb-2">
                {tab === "friends"
                  ? "No doubles partner yet"
                  : tab === "incoming"
                  ? "No pending requests"
                  : "No sent requests"}
              </h3>
              <p className="text-gray-500 text-sm mb-6">
                {tab === "friends"
                  ? "Discover players and send them a friend request!"
                  : tab === "incoming"
                  ? "When someone sends you a request, it will appear here."
                  : "Requests you've sent will show up here."}
              </p>
              {tab === "friends" && (
                <Link href="/search" className="btn-primary">
                  Discover Players
                </Link>
              )}
            </div>
          ) : (
            friendsList.map((entry, i) => (
              <div
                key={entry.friendshipId}
                className={`animate-fade-in-up stagger-${Math.min(i + 2, 5)} bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-5 flex items-center gap-4 card-hover`}
              >
                <Link href={`/profile/${entry.user.id}`}>
                  <Avatar name={entry.user.name} image={entry.user.profileImageUrl} size="lg" />
                </Link>
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/profile/${entry.user.id}`}
                    className="font-semibold text-gray-900 hover:text-court-green transition-colors text-sm"
                  >
                    {entry.user.name}
                  </Link>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {SKILL_LABELS[entry.user.skillLevel] || entry.user.skillLevel}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {tab === "friends" && (
                    <Link
                      href={`/chat/${entry.user.id}`}
                      className="btn-primary btn-sm"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                      </svg>
                      Chat
                    </Link>
                  )}
                  {tab === "incoming" && (
                    <>
                      <button
                        onClick={() => acceptRequest(entry.friendshipId)}
                        disabled={actionLoading === entry.friendshipId}
                        className="btn-primary btn-sm"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => rejectRequest(entry.friendshipId)}
                        disabled={actionLoading === entry.friendshipId}
                        className="btn-danger btn-sm"
                      >
                        Decline
                      </button>
                    </>
                  )}
                  {tab === "outgoing" && (
                    <span className="text-xs text-gray-400 font-medium px-3 py-1.5 bg-gray-50 rounded-full">
                      Pending
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
    </div>
  );
}
