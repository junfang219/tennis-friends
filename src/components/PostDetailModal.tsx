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
          // PostCard's author header becomes sticky when onClose is set,
          // keeping the close X reachable for the entire scroll range
          // (long posts with comments / replies would otherwise scroll
          // it off-screen). The hide-from-feed X is suppressed in
          // modal mode.
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
