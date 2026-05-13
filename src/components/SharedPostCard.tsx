"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import Avatar from "@/components/Avatar";
import PostCard from "@/components/PostCard";

export type SharedPost = {
  id: string;
  content: string;
  mediaUrl: string;
  mediaType: string;
  postType: string;
  playDate: string;
  playTime: string;
  courtLocation: string;
  gameType: string;
  playersNeeded: number;
  playersConfirmed: number;
  courtBooked: boolean;
  isComplete: boolean;
  author: { id: string; name: string; profileImageUrl: string };
};

export default function SharedPostCard({ post }: { post: SharedPost }) {
  const [showFullPost, setShowFullPost] = useState(false);
  const [fullPostData, setFullPostData] = useState<Record<string, unknown> | null>(null);
  const [loadingPost, setLoadingPost] = useState(false);
  const isFindPlayers = post.postType === "find_players";

  const openFullPost = async () => {
    setShowFullPost(true);
    if (!fullPostData) {
      setLoadingPost(true);
      const res = await fetch(`/api/posts/${post.id}`);
      if (res.ok) {
        const data = await res.json();
        setFullPostData(data);
      }
      setLoadingPost(false);
    }
  };

  return (
    <>
      <button onClick={openFullPost} className="text-left bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden max-w-full hover:shadow-md transition-shadow w-full">
        <div className="px-3 pt-3 pb-2 flex items-center gap-2">
          <Avatar name={post.author.name} image={post.author.profileImageUrl} size="sm" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-900 truncate">{post.author.name}</p>
            {isFindPlayers && (
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase ${post.isComplete ? "bg-green-100 text-green-700" : "bg-court-green text-ball-yellow"}`}>
                {post.isComplete ? "Game Full" : "Looking for Players"}
              </span>
            )}
          </div>
        </div>

        {post.content && (
          <p className="px-3 pb-2 text-xs text-gray-700 line-clamp-3">{post.content}</p>
        )}

        {post.mediaUrl && post.mediaType === "image" && (
          <img src={post.mediaUrl} alt="Post" className="w-full max-h-40 object-cover" />
        )}

        {isFindPlayers && (
          <div className="px-3 py-2 bg-court-green/5 border-t border-gray-100">
            <div className="flex items-center gap-3 text-[11px] text-gray-600">
              {post.playDate && <span>{post.playDate}</span>}
              {post.playTime && <span>{post.playTime}</span>}
              {post.courtLocation && <span className="truncate">{post.courtLocation}</span>}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[11px] text-gray-500 capitalize">{post.gameType}</span>
              <span className="text-[11px] text-gray-500">{post.playersConfirmed}/{post.playersNeeded} players</span>
            </div>
          </div>
        )}

        <div className="px-3 py-1.5 border-t border-gray-100 text-center">
          <span className="text-[10px] text-gray-400 font-medium">Tap to open post</span>
        </div>
      </button>

      {showFullPost && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[999] bg-black/50 flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
          onClick={() => setShowFullPost(false)}
        >
          <div
            className="w-full sm:max-w-lg sm:my-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-end mb-2 px-2 sm:px-0">
              <button
                onClick={() => setShowFullPost(false)}
                className="w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {loadingPost ? (
              <div className="bg-white rounded-2xl p-8 text-center">
                <svg className="animate-spin w-6 h-6 text-court-green mx-auto" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                  <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </div>
            ) : fullPostData ? (
              <PostCard post={fullPostData as Parameters<typeof PostCard>[0]["post"]} />
            ) : (
              <div className="bg-white rounded-2xl p-8 text-center">
                <p className="text-gray-500 text-sm">Post not found</p>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
