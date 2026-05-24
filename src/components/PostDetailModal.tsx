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
      className="fixed inset-0 z-[999] bg-black/50 flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div className="w-full sm:max-w-lg sm:my-8" onClick={(e) => e.stopPropagation()}>
        <div
          className="flex justify-end mb-2 px-2 sm:px-0"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px))" }}
        >
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center transition-colors"
            aria-label="Close"
          >
            <svg
              width="18"
              height="18"
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
          <PostCard
            post={post}
            initialExpanded={withComments}
            initialShowComments={withComments}
            onOpenChat={onClose}
          />
        )}
      </div>
    </div>,
    document.body
  );
}
