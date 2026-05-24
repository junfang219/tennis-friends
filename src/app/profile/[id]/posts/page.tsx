"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getProfile, listPostsByAuthor } from "@/lib/supabase/queries";
import { toPostCamel, type PostCamel } from "@/lib/supabase/adapters";
import PostCard from "@/components/PostCard";

// Instagram-style "Posts" feed: tapping a thumbnail in the profile
// Photos/Videos grid lands here scrolled to that post, with the
// author's other posts above/below for browsing. Replaces the
// per-post modal popup that lived inline on the profile pages.

type FeedPost = PostCamel & {
  likeCount: number;
  commentCount: number;
  isLiked: boolean;
};

export default function ProfilePostsPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const userId = String(params.id);
  const focusId = searchParams.get("focus");

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [headerLabel, setHeaderLabel] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [highlightedPostId, setHighlightedPostId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    Promise.all([
      listPostsByAuthor(supabase, userId).then((rows) =>
        rows.map((r) => toPostCamel(r) as unknown as FeedPost)
      ),
      getProfile(supabase, userId),
    ])
      .then(([rows, profile]) => {
        setPosts(rows);
        setHeaderLabel(
          profile?.handle ? `@${profile.handle}` : profile?.name ?? ""
        );
      })
      .finally(() => setLoading(false));
  }, [userId]);

  // Mirror the home feed's scroll-into-focus + brief highlight pattern
  // (see src/app/page.tsx targetPostId effect). Falls through silently
  // if the focused post id is missing or no longer in the author's set.
  useEffect(() => {
    if (!focusId || loading || posts.length === 0) return;
    if (!posts.some((p) => p.id === focusId)) return;
    const t = setTimeout(() => {
      const el = document.querySelector(
        `[data-post-id="${focusId}"]`
      ) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "auto", block: "start" });
        setHighlightedPostId(focusId);
        setTimeout(() => setHighlightedPostId(null), 2000);
      }
    }, 50);
    return () => clearTimeout(t);
  }, [focusId, loading, posts]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-4">
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="w-9 h-9 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-700 transition-colors"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-lg font-bold text-gray-900 leading-tight">
            Posts
          </h1>
          {headerLabel && (
            <p className="text-xs text-gray-500 truncate">{headerLabel}</p>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-5">
          {[1, 2].map((i) => (
            <div key={i} className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="skeleton w-full h-64 rounded-xl" />
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-court-green-pale/20">
          <p className="text-gray-500 text-sm">No posts yet.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {posts.map((post) => (
            <div
              key={post.id}
              data-post-id={post.id}
              className={`rounded-2xl transition-shadow ${
                highlightedPostId === post.id
                  ? "ring-2 ring-court-green ring-offset-2"
                  : ""
              }`}
            >
              <PostCard
                post={post as unknown as Parameters<typeof PostCard>[0]["post"]}
                onDelete={(id) =>
                  setPosts((prev) => prev.filter((p) => p.id !== id))
                }
                onUpdate={(id, updates) =>
                  setPosts((prev) =>
                    prev.map((p) =>
                      p.id === id ? { ...p, ...(updates as Partial<FeedPost>) } : p
                    )
                  )
                }
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
