"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Avatar from "@/components/Avatar";

type FriendRequest = {
  friendshipId: string;
  user: {
    id: string;
    name: string;
    profileImageUrl: string;
    skillLevel: string;
  };
  createdAt: string;
};

const SKILL_LABELS: Record<string, string> = {
  BEGINNER: "Beginner",
  INTERMEDIATE: "Intermediate",
  ADVANCED: "Advanced",
  PRO: "Pro",
};

function timeAgo(date: string) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function FriendRequestsPage() {
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string>("");

  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetch("/api/users?tab=friends");
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setRequests(data.incomingRequests || []);
    } catch {
      // Silently fail — empty list
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const acceptRequest = async (friendshipId: string) => {
    setActionLoading(friendshipId);
    try {
      const res = await fetch("/api/friends/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendshipId }),
      });
      if (res.ok) {
        setRequests((prev) =>
          prev.filter((r) => r.friendshipId !== friendshipId)
        );
      }
    } catch {
      // ignore
    } finally {
      setActionLoading("");
    }
  };

  const rejectRequest = async (friendshipId: string) => {
    setActionLoading(friendshipId);
    try {
      const res = await fetch("/api/friends/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendshipId }),
      });
      if (res.ok) {
        setRequests((prev) =>
          prev.filter((r) => r.friendshipId !== friendshipId)
        );
      }
    } catch {
      // ignore
    } finally {
      setActionLoading("");
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/friends"
          className="w-9 h-9 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500 transition-colors"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <div>
          <h1 className="font-display text-xl font-bold text-gray-900">
            Friend Requests
          </h1>
          {!loading && (
            <p className="text-sm text-gray-500">
              {requests.length} pending request
              {requests.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <svg
            className="animate-spin w-6 h-6 text-court-green"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="3"
              opacity="0.3"
            />
            <path
              d="M12 2a10 10 0 019.95 9"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
        </div>
      )}

      {/* Empty state */}
      {!loading && requests.length === 0 && (
        <div className="text-center py-16">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-gray-400"
            >
              <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <polyline points="17 11 19 13 23 9" />
            </svg>
          </div>
          <h3 className="font-semibold text-gray-700 mb-1">All caught up!</h3>
          <p className="text-sm text-gray-500">
            No pending friend requests right now.
          </p>
        </div>
      )}

      {/* Request list */}
      {!loading && requests.length > 0 && (
        <div className="space-y-3">
          {requests.map((r) => (
            <div
              key={r.friendshipId}
              className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-4 flex items-center gap-4"
            >
              <Link href={`/profile/${r.user.id}`}>
                <Avatar
                  name={r.user.name}
                  image={r.user.profileImageUrl}
                  size="lg"
                />
              </Link>
              <div className="flex-1 min-w-0">
                <Link
                  href={`/profile/${r.user.id}`}
                  className="font-semibold text-gray-900 hover:text-court-green transition-colors text-sm"
                >
                  {r.user.name}
                </Link>
                <p className="text-xs text-gray-400 mt-0.5">
                  {SKILL_LABELS[r.user.skillLevel] || r.user.skillLevel}
                  {r.createdAt && ` · ${timeAgo(r.createdAt)}`}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => acceptRequest(r.friendshipId)}
                  disabled={actionLoading === r.friendshipId}
                  className="px-4 py-2 bg-court-green text-white text-xs font-semibold rounded-lg hover:bg-court-green-light disabled:opacity-50 transition-colors"
                >
                  Accept
                </button>
                <button
                  onClick={() => rejectRequest(r.friendshipId)}
                  disabled={actionLoading === r.friendshipId}
                  className="px-4 py-2 bg-gray-100 text-gray-700 text-xs font-semibold rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
