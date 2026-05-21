"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
} from "@/lib/supabase/queries";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  const sendRequest = async () => {
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await sendFriendRequest(supabase, userId);
      // The new row id isn't returned by sendFriendRequest; refresh to pick it up.
      setState({ friendshipId: null, friendshipStatus: "PENDING", isRequester: true });
    } catch {
      // ignore
    }
    setLoading(false);
  };

  const acceptRequest = async () => {
    if (!state.friendshipId) return;
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await acceptFriendRequest(supabase, state.friendshipId);
      setState({ ...state, friendshipStatus: "ACCEPTED" });
    } catch {
      // ignore
    }
    setLoading(false);
    router.refresh();
  };

  const rejectRequest = async () => {
    if (!state.friendshipId) return;
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await rejectFriendRequest(supabase, state.friendshipId);
      setState({ friendshipId: null, friendshipStatus: null, isRequester: false });
    } catch {
      // ignore
    }
    setLoading(false);
  };

  const cancelRequest = async () => {
    setMenuOpen(false);
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      // Symmetric removal: deletes the pending friendship in either direction.
      await removeFriend(supabase, userId);
      setState({ friendshipId: null, friendshipStatus: null, isRequester: false });
    } catch {
      // ignore
    }
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

  // Pending - I sent the request. Tapping opens a small dropdown with a
  // "Cancel request" action that withdraws the pending friendship.
  if (state.friendshipStatus === "PENDING" && state.isRequester) {
    return (
      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="btn-secondary btn-sm"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12,6 12,12 16,14" />
          </svg>
          Request Sent
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform ${menuOpen ? "rotate-180" : ""}`}
          >
            <polyline points="6,9 12,15 18,9" />
          </svg>
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-2 z-50 min-w-[160px] bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden py-1"
          >
            <button
              role="menuitem"
              onClick={cancelRequest}
              className="w-full text-left px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              Cancel request
            </button>
          </div>
        )}
      </div>
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
