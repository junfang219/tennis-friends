"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import PostCard from "./PostCard";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getPost } from "@/lib/supabase/queries";
import { toPostCamel } from "@/lib/supabase/adapters";

// Shared "tap a notification → see the post" modal. Used by both the
// in-page NotificationBell dropdown and the standalone /notifications
// page so the two paths behave identically (especially on iOS, where
// the standalone page is the primary surface and used to router.push
// to the home feed without expanding comments).

type PostShape = Parameters<typeof PostCard>[0]["post"];

interface PostDetailModalProps {
  postId: string | null;
  // Comment/reply notifications open with comments expanded; like and
  // friend/event notifications can pass false to just show the post.
  withComments?: boolean;
  onClose: () => void;
}

export default function PostDetailModal({
  postId,
  withComments = false,
  onClose,
}: PostDetailModalProps) {
  const [post, setPost] = useState<PostShape | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!postId) {
      setPost(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setPost(null);
    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const row = await getPost(supabase, postId);
        if (cancelled) return;
        setPost(row ? (toPostCamel(row) as unknown as PostShape) : null);
      } catch {
        if (!cancelled) setPost(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [postId]);

  if (!postId) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[999] bg-black/50 overflow-y-auto"
      onClick={onClose}
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div
        className="w-full sm:max-w-lg sm:my-8 my-2 sm:mx-auto"
        // Reserve room below the card so the comment input clears the
        // iOS BottomNav (which lives at z-9999, above this modal). The
        // body already gets a 5rem padding via BottomNav, but that's
        // applied to <body> and doesn't affect this fixed overlay.
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky close X — anchored at the top-right of the card column.
            Stays visible for the entire scroll range (long posts with
            comments + replies would otherwise scroll past the in-card
            chrome and leave the user stranded with no close affordance).
            h-0 + overflow-visible so the row doesn't push the card
            down; the button overlaps the card's top-right corner. */}
        <div className="sticky top-2 z-20 h-0 overflow-visible pointer-events-none">
          <div className="flex justify-end pr-2">
            <button
              onClick={onClose}
              className="pointer-events-auto w-9 h-9 rounded-full bg-white shadow-md text-gray-600 hover:text-gray-900 flex items-center justify-center transition-colors"
              aria-label="Close"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {loading || !post ? (
          <div className="bg-white rounded-2xl p-8 text-center">
            <svg
              className="animate-spin w-6 h-6 text-court-green mx-auto"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
              <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </div>
        ) : (
          // PostCard's in-card "hide from feed" X is suppressed in modal
          // mode (onClose set) — the sticky button above is the sole
          // close affordance. onOpenChat still closes the modal so
          // tapping a session chat link doesn't leave a stale overlay.
          <PostCard
            post={post}
            initialExpanded={withComments}
            initialShowComments={withComments}
            onClose={onClose}
            onOpenChat={onClose}
          />
        )}
      </div>
    </div>,
    document.body
  );
}
