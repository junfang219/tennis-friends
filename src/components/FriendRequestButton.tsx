"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type FriendshipState = {
  friendshipId: string | null;
  friendshipStatus: string | null;
  isRequester: boolean;
};

export default function FriendRequestButton({
  userId,
  initial,
}: {
  userId: string;
  initial: FriendshipState;
}) {
  const [state, setState] = useState(initial);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const sendRequest = async () => {
    setLoading(true);
    const res = await fetch("/api/friends/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresseeId: userId }),
    });
    if (res.ok) {
      const data = await res.json();
      setState({ friendshipId: data.id, friendshipStatus: "PENDING", isRequester: true });
    }
    setLoading(false);
  };

  const acceptRequest = async () => {
    setLoading(true);
    await fetch("/api/friends/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ friendshipId: state.friendshipId }),
    });
    setState({ ...state, friendshipStatus: "ACCEPTED" });
    setLoading(false);
    router.refresh();
  };

  const rejectRequest = async () => {
    setLoading(true);
    await fetch("/api/friends/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ friendshipId: state.friendshipId }),
    });
    setState({ friendshipId: null, friendshipStatus: null, isRequester: false });
    setLoading(false);
  };

  if (loading) {
    return (
      <button disabled className="btn-secondary btn-sm opacity-60">
        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
          <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </button>
    );
  }

  // No relationship
  if (!state.friendshipStatus) {
    return (
      <button onClick={sendRequest} className="btn-primary btn-sm">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
          <circle cx="8.5" cy="7" r="4" />
          <line x1="20" y1="8" x2="20" y2="14" />
          <line x1="23" y1="11" x2="17" y2="11" />
        </svg>
        Add Friend
      </button>
    );
  }

  // Pending - I sent the request
  if (state.friendshipStatus === "PENDING" && state.isRequester) {
    return (
      <button disabled className="btn-secondary btn-sm opacity-70 cursor-default">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12,6 12,12 16,14" />
        </svg>
        Request Sent
      </button>
    );
  }

  // Pending - they sent the request to me
  if (state.friendshipStatus === "PENDING" && !state.isRequester) {
    return (
      <div className="flex items-center gap-2">
        <button onClick={acceptRequest} className="btn-primary btn-sm">
          Accept
        </button>
        <button onClick={rejectRequest} className="btn-danger btn-sm">
          Decline
        </button>
      </div>
    );
  }

  // Accepted
  if (state.friendshipStatus === "ACCEPTED") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-court-green-soft px-3 py-1.5 bg-court-green-soft/10 rounded-xl">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <polyline points="20,6 9,17 4,12" />
        </svg>
        Friends
      </span>
    );
  }

  return null;
}
