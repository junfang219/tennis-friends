"use client";

import { useEffect, useRef, useState } from "react";
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
  const scrollRef = useRef<HTMLDivElement>(null);

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

  // iOS only: disable WKWebView's auto-scroll-to-focused-input and
  // listen for keyboardDidShow to pin the modal to its bottom AFTER
  // the keyboard animation finishes. Without `setScroll({ disabled })`
  // iOS tries to centre the input in the visualViewport and undoes
  // our scroll; without `keyboardDidShow` our scrollTo runs against
  // the pre-resize layout and undershoots. Fires multiple times because
  // the WebView resize on iOS is a stepped animation — content height
  // recomputes a few frames after the event fires, and a single scroll
  // can land at the pre-resize maximum rather than the post-resize one.
  useEffect(() => {
    if (!postId) return;
    let cleanup: (() => void) | undefined;
    const pinToBottom = () => {
      const sc = scrollRef.current;
      if (sc) sc.scrollTo({ top: sc.scrollHeight });
    };
    (async () => {
      try {
        const core = await import("@capacitor/core");
        if (!core.Capacitor.isNativePlatform()) return;
        const { Keyboard } = await import("@capacitor/keyboard");
        await Keyboard.setScroll({ isDisabled: true });
        const handle = await Keyboard.addListener("keyboardDidShow", () => {
          pinToBottom();
          requestAnimationFrame(pinToBottom);
          setTimeout(pinToBottom, 100);
          setTimeout(pinToBottom, 300);
        });
        cleanup = () => {
          handle.remove();
          Keyboard.setScroll({ isDisabled: false }).catch(() => {});
        };
      } catch {
        // Capacitor / @capacitor/keyboard not in this build — web no-op.
      }
    })();
    return () => {
      cleanup?.();
    };
  }, [postId]);

  if (!postId) return null;

  return createPortal(
    <div
      ref={scrollRef}
      // z-[10000] sits above the BottomNav (z-9999) so the sticky
      // comment input at the bottom of the post card isn't covered by
      // it. The modal already eats the whole screen anyway, so nav-tab
      // visibility while open isn't useful.
      className="fixed inset-0 z-[10000] bg-black/50 overflow-y-auto"
      onClick={onClose}
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div
        className="w-full sm:max-w-lg sm:my-8 my-2 sm:mx-auto"
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
