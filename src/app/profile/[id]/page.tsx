"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import FriendRequestButton from "@/components/FriendRequestButton";
import PostCard from "@/components/PostCard";

type UserProfile = {
  id: string;
  name: string;
  email: string;
  bio: string;
  skillLevel: string;
  favoriteSurface: string;
  profileImageUrl: string;
  createdAt: string;
  friendCount: number;
  friendshipId: string | null;
  friendshipStatus: string | null;
  isRequester: boolean;
  posts: {
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
    commentsDisabled: boolean;
    createdAt: string;
    _count: { likes: number; comments: number; playRequests: number };
    myPlayRequest: { id: string; status: string; note: string } | null;
    groups: { id: string; name: string }[];
  }[];
};

const SKILL_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  professional: "Professional",
};

const SURFACE_LABELS: Record<string, string> = {
  hard: "Hard Court",
  clay: "Clay",
  grass: "Grass",
  indoor: "Indoor",
};

const SURFACE_COLORS: Record<string, string> = {
  hard: "bg-blue-100 text-blue-700",
  clay: "bg-orange-100 text-orange-700",
  grass: "bg-green-100 text-green-700",
  indoor: "bg-purple-100 text-purple-700",
};

export default function UserProfilePage() {
  const params = useParams();
  const { data: session } = useSession();
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);

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
          <div className="h-32 bg-gradient-to-br from-court-green via-court-green-light to-court-green-soft court-pattern relative">
            <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" />
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
                <p className="text-gray-500 text-sm">{user.email}</p>
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
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${SURFACE_COLORS[user.favoriteSurface] || "bg-gray-100 text-gray-700"}`}>
                {SURFACE_LABELS[user.favoriteSurface] || user.favoriteSurface}
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-ball-yellow/20 text-court-green">
                {SKILL_LABELS[user.skillLevel] || user.skillLevel}
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-court-green-pale/20 text-court-green-light">
                {user.friendCount} {user.friendCount === 1 ? "friend" : "friends"}
              </span>
            </div>

            <div className="text-xs text-gray-400">
              Member since {new Date(user.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </div>
          </div>
        </div>

        {/* Posts */}
        {user.posts.length > 0 && (
          <div className="mt-6 space-y-4">
            <h3 className="font-display text-lg font-bold text-gray-800">
              Recent Posts
            </h3>
            {user.posts.map((post) => (
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
