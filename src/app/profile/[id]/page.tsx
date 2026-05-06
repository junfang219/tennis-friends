"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import FriendRequestButton from "@/components/FriendRequestButton";
import PostCard from "@/components/PostCard";
import { AGE_LABELS, GENDER_LABELS, formatRating } from "@/lib/profileLabels";

type Highlight = {
  id: string;
  userId: string;
  mediaUrl: string;
  mediaType: string;
  caption: string;
  createdAt: string;
};

type UserPost = {
  id: string;
  content: string;
  mediaUrl: string;
  mediaType: string;
  photoUrls?: string[];
  postType: string;
  playDate: string;
  playTime: string;
  playDuration: number;
  courtLocation: string;
  gameType: string;
  playersNeeded: number;
  playersConfirmed: number;
  courtBooked: boolean;
  isComplete: boolean;
  sessionChatId: string | null;
  commentsDisabled: boolean;
  createdAt: string;
  _count: { likes: number; comments: number; playRequests: number };
  myPlayRequest: { id: string; status: string; note: string } | null;
  groups: { id: string; name: string }[];
};

type UserProfile = {
  id: string;
  name: string;
  email: string;
  bio: string;
  skillLevel: string;
  favoriteSurface: string;
  profileImageUrl: string;
  gender: string;
  ageRange: string;
  ratingSystem: string;
  ntrpRating: number | null;
  utrRating: number | null;
  handle: string | null;
  coverImageUrl: string;
  coverOffsetY: number;
  coverScale: number;
  customTags: string[];
  createdAt: string;
  friendCount: number;
  friendshipId: string | null;
  friendshipStatus: string | null;
  isRequester: boolean;
  highlights: Highlight[];
  posts: UserPost[];
};

export default function UserProfilePage() {
  const params = useParams();
  const { data: session } = useSession();
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [tab, setTab] = useState<"find_players" | "posts" | "videos">("posts");
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [viewingHighlightIdx, setViewingHighlightIdx] = useState<number | null>(null);

  useEffect(() => {
    if (params.id === session?.user?.id) {
      router.push("/profile");
      return;
    }
    fetch(`/api/users/${params.id}`)
      .then((r) => r.json())
      .then(setUser);
  }, [params.id, session?.user?.id, router]);

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-white rounded-3xl p-8 shadow-sm">
          <div className="flex items-center gap-6">
            <div className="skeleton w-24 h-24 rounded-full" />
            <div className="space-y-3 flex-1">
              <div className="skeleton w-48 h-6" />
              <div className="skeleton w-32 h-4" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="animate-fade-in-up">
        <div className="bg-white rounded-3xl shadow-sm border border-court-green-pale/20 overflow-hidden">
          <div
            className={`h-32 relative overflow-hidden ${user.coverImageUrl ? "" : "bg-gradient-to-br from-court-green via-court-green-light to-court-green-soft court-pattern"}`}
          >
            {user.coverImageUrl && (
              <img
                src={user.coverImageUrl}
                alt=""
                draggable={false}
                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                style={{
                  objectPosition: `center ${user.coverOffsetY ?? 50}%`,
                  transform: `scale(${(user.coverScale ?? 100) / 100})`,
                  transformOrigin: "center",
                }}
              />
            )}
            <div className={`absolute inset-0 bg-gradient-to-t ${user.coverImageUrl ? "from-black/30" : "from-black/10"} to-transparent pointer-events-none`} />
          </div>

          <div className="px-8 -mt-12 relative">
            <div className="inline-block ring-4 ring-white rounded-full shadow-lg">
              <Avatar name={user.name} image={user.profileImageUrl} size="xl" />
            </div>
          </div>

          <div className="px-8 pb-8 pt-4">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h1 className="font-display text-2xl font-bold text-gray-900">
                  {user.name}
                </h1>
                {user.handle && (
                  <p className="text-gray-500 text-sm font-medium">@{user.handle}</p>
                )}
              </div>
              <FriendRequestButton
                userId={user.id}
                initial={{
                  friendshipId: user.friendshipId,
                  friendshipStatus: user.friendshipStatus,
                  isRequester: user.isRequester,
                }}
              />
            </div>

            {user.bio && (
              <p className="text-gray-600 text-sm leading-relaxed mb-5">{user.bio}</p>
            )}

            <div className="flex flex-wrap gap-3 mb-5">
              {formatRating(user) && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-ball-yellow/20 text-court-green">
                  {formatRating(user)}
                </span>
              )}
              {user.ageRange && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                  {AGE_LABELS[user.ageRange] || user.ageRange}
                </span>
              )}
              {user.gender && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                  {GENDER_LABELS[user.gender] || user.gender}
                </span>
              )}
              {(user.customTags || []).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-court-green-pale/15 text-court-green-light"
                >
                  {tag}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-court-green-pale/20 text-court-green-light">
                {user.friendCount} {user.friendCount === 1 ? "friend" : "friends"}
              </span>
            </div>

            {/* Highlights row (read-only) */}
            {user.highlights && user.highlights.length > 0 && (
              <div className="mt-4 -mx-2 px-2 flex gap-3 overflow-x-auto scrollbar-hide">
                {user.highlights.map((h, idx) => (
                  <button
                    key={h.id}
                    onClick={() => setViewingHighlightIdx(idx)}
                    className="shrink-0 group"
                    aria-label="Open highlight"
                  >
                    <div className="w-16 h-16 rounded-full p-[2px] bg-gradient-to-tr from-court-green via-ball-yellow to-clay group-hover:scale-105 transition-transform">
                      <div className="w-full h-full rounded-full overflow-hidden bg-black">
                        {h.mediaType === "video" ? (
                          <video
                            src={`${h.mediaUrl}#t=0.1`}
                            preload="metadata"
                            playsInline
                            muted
                            className="w-full h-full object-cover pointer-events-none"
                          />
                        ) : (
                          <img
                            src={h.mediaUrl}
                            alt=""
                            loading="lazy"
                            className="w-full h-full object-cover"
                          />
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Tabs + per-tab layouts (mirrors /profile) */}
        {(() => {
          const isGamePost = (p: { postType?: string }) =>
            p.postType === "find_players" || p.postType === "propose_team";
          const findPlayersPosts = user.posts.filter((p) =>
            isGamePost(p) || (!p.mediaUrl && p.mediaType !== "image" && p.mediaType !== "video")
          );
          const photoPosts = user.posts.filter((p) => p.mediaType === "image" && !isGamePost(p));
          const videoPosts = user.posts.filter((p) => p.mediaType === "video" && !isGamePost(p));
          const filtered =
            tab === "find_players" ? findPlayersPosts :
            tab === "posts" ? photoPosts :
            videoPosts;

          const renderPostCard = (post: UserPost) => (
            <PostCard
              key={post.id}
              post={{
                ...post,
                author: { id: user.id, name: user.name, profileImageUrl: user.profileImageUrl },
                likeCount: post._count.likes,
                commentCount: post._count.comments,
                pendingRequestCount: post._count.playRequests,
                isLiked: false,
                myPlayRequest: post.myPlayRequest,
                groups: post.groups,
              }}
            />
          );

          return (
            <div className="mt-6">
              {/* Icon tabs */}
              <div className="flex gap-1 bg-white rounded-2xl p-1.5 shadow-sm border border-court-green-pale/20 mb-4">
                <button
                  onClick={() => setTab("find_players")}
                  title="Find Players"
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl transition-all ${
                    tab === "find_players" ? "bg-court-green text-white shadow-md" : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={tab === "find_players" ? 2.5 : 2} strokeLinecap="round">
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                </button>
                <button
                  onClick={() => setTab("posts")}
                  title="Photos"
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl transition-all ${
                    tab === "posts" ? "bg-court-green text-white shadow-md" : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={tab === "posts" ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21,15 16,10 5,21" />
                  </svg>
                </button>
                <button
                  onClick={() => setTab("videos")}
                  title="Videos"
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl transition-all ${
                    tab === "videos" ? "bg-court-green text-white shadow-md" : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={tab === "videos" ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="23,7 16,12 23,17" />
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                  </svg>
                </button>
              </div>

              {/* Tab content */}
              {filtered.length === 0 ? (
                <div className="text-center py-12 bg-white rounded-2xl shadow-sm border border-court-green-pale/20">
                  <div className="w-12 h-12 bg-ball-yellow/20 rounded-full flex items-center justify-center mx-auto mb-3">
                    {tab === "find_players" && (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-court-green-soft" strokeLinecap="round">
                        <circle cx="11" cy="11" r="8" />
                        <path d="M21 21l-4.35-4.35" />
                      </svg>
                    )}
                    {tab === "posts" && (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-court-green-soft" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21,15 16,10 5,21" />
                      </svg>
                    )}
                    {tab === "videos" && (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-court-green-soft" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="23,7 16,12 23,17" />
                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                      </svg>
                    )}
                  </div>
                  <p className="text-gray-500 text-sm">
                    {tab === "find_players" && `${user.name} hasn't posted anything yet.`}
                    {tab === "posts" && `${user.name} hasn't shared any photos.`}
                    {tab === "videos" && `${user.name} hasn't shared any videos.`}
                  </p>
                </div>
              ) : tab === "posts" ? (
                <div className="grid grid-cols-3 gap-1">
                  {photoPosts.map((post) => {
                    const urls = (post.photoUrls && post.photoUrls.length > 0)
                      ? post.photoUrls
                      : (post.mediaUrl ? [post.mediaUrl] : []);
                    const cover = urls[0];
                    if (!cover) return null;
                    return (
                      <button
                        key={post.id}
                        onClick={() => setSelectedPostId(post.id)}
                        className="relative aspect-square overflow-hidden bg-gray-100 group"
                        aria-label={urls.length > 1 ? `Open photo set (${urls.length})` : "Open photo"}
                      >
                        <img
                          src={cover}
                          alt=""
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:opacity-90 transition-opacity"
                        />
                        {urls.length > 1 && (
                          <span className="absolute top-1.5 right-1.5 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full pointer-events-none flex items-center gap-1">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="3" width="14" height="14" rx="2" />
                              <path d="M7 7h14v14" />
                            </svg>
                            {urls.length}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : tab === "videos" ? (
                <div className="grid grid-cols-3 gap-1">
                  {videoPosts.map((post) => {
                    if (!post.mediaUrl) return null;
                    return (
                      <button
                        key={post.id}
                        onClick={() => setSelectedPostId(post.id)}
                        className="relative aspect-square overflow-hidden bg-black group"
                        aria-label="Open video"
                      >
                        <video
                          src={`${post.mediaUrl}#t=0.1`}
                          preload="metadata"
                          playsInline
                          muted
                          className="w-full h-full object-cover group-hover:opacity-90 transition-opacity pointer-events-none"
                        />
                        <span className="absolute top-1.5 right-1.5 bg-black/60 text-white px-1 py-0.5 rounded-full pointer-events-none">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="6 4 20 12 6 20" />
                          </svg>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-4">
                  {filtered.map((post) => renderPostCard(post))}
                </div>
              )}
            </div>
          );
        })()}

        {/* Photo / Video modal — opens on grid tap */}
        {selectedPostId && (() => {
          const post = user.posts.find((p) => p.id === selectedPostId);
          if (!post) return null;
          return createPortal(
            <div
              className="fixed inset-0 z-[100] bg-black/60 flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
              onClick={() => setSelectedPostId(null)}
            >
              <div className="w-full sm:max-w-lg sm:my-8" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-end mb-2 px-2 sm:px-0">
                  <button
                    onClick={() => setSelectedPostId(null)}
                    className="w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center transition-colors"
                    aria-label="Close"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                <PostCard
                  post={{
                    ...post,
                    author: { id: user.id, name: user.name, profileImageUrl: user.profileImageUrl },
                    likeCount: post._count.likes,
                    commentCount: post._count.comments,
                    pendingRequestCount: post._count.playRequests,
                    isLiked: false,
                    myPlayRequest: post.myPlayRequest,
                    groups: post.groups,
                  }}
                />
              </div>
            </div>,
            document.body
          );
        })()}

        {/* Highlights viewer — read-only, no Delete */}
        {viewingHighlightIdx !== null && user.highlights && user.highlights[viewingHighlightIdx] && createPortal(
          (() => {
            const h = user.highlights[viewingHighlightIdx];
            return (
              <div
                className="fixed inset-0 z-[10000] bg-black/95 flex items-center justify-center p-4"
                onClick={() => setViewingHighlightIdx(null)}
              >
                <button
                  onClick={() => setViewingHighlightIdx(null)}
                  className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                  aria-label="Close"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
                {user.highlights.length > 1 && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); setViewingHighlightIdx((i) => (i === null ? 0 : (i - 1 + user.highlights.length) % user.highlights.length)); }}
                      className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
                      aria-label="Previous"
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setViewingHighlightIdx((i) => (i === null ? 0 : (i + 1) % user.highlights.length)); }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
                      aria-label="Next"
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 6 15 12 9 18" /></svg>
                    </button>
                  </>
                )}
                <div
                  className="relative max-w-[92vw] max-h-[85vh] flex items-center justify-center"
                  onClick={(e) => e.stopPropagation()}
                >
                  {h.mediaType === "video" ? (
                    <video
                      src={`${h.mediaUrl}#t=0.1`}
                      controls
                      autoPlay
                      playsInline
                      className="max-w-[92vw] max-h-[85vh] rounded-lg"
                    />
                  ) : (
                    <img
                      src={h.mediaUrl}
                      alt=""
                      className="max-w-[92vw] max-h-[85vh] object-contain rounded-lg"
                    />
                  )}
                </div>
              </div>
            );
          })(),
          document.body
        )}
      </div>
    </div>
  );
}
