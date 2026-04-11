"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import PostCard from "@/components/PostCard";
import PostComposer from "@/components/PostComposer";

type Post = {
  id: string;
  content: string;
  mediaUrl?: string;
  mediaType?: string;
  postType?: string;
  playDate?: string;
  playTime?: string;
  courtLocation?: string;
  gameType?: string;
  playersNeeded?: number;
  playersConfirmed?: number;
  courtBooked?: boolean;
  isComplete?: boolean;
  commentsDisabled?: boolean;
  pendingRequestCount?: number;
  myPlayRequest?: { id: string; status: string; note: string } | null;
  commentCount?: number;
  createdAt: string;
  author: { id: string; name: string; profileImageUrl: string };
  likeCount: number;
  isLiked: boolean;
  groups?: { id: string; name: string }[];
  friendGroups?: { id: string; name: string }[];
};

type Profile = {
  id: string;
  name: string;
  email: string;
  bio: string;
  skillLevel: string;
  favoriteSurface: string;
  profileImageUrl: string;
  createdAt: string;
  _count: { sentRequests: number; receivedRequests: number };
  posts: Post[];
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

export default function ProfilePage() {
  const { data: session } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<"find_players" | "posts" | "videos">("find_players");
  const [form, setForm] = useState({
    name: "",
    bio: "",
    skillLevel: "",
    favoriteSurface: "",
    profileImageUrl: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data) => {
        setProfile(data);
        setForm({
          name: data.name,
          bio: data.bio,
          skillLevel: data.skillLevel,
          favoriteSurface: data.favoriteSurface,
          profileImageUrl: data.profileImageUrl,
        });
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      const updated = await res.json();
      setProfile({ ...profile!, ...updated });
      setEditing(false);
    }
    setSaving(false);
  };

  if (!profile) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-white rounded-3xl p-8 shadow-sm">
          <div className="flex items-center gap-6">
            <div className="skeleton w-24 h-24 rounded-full" />
            <div className="space-y-3 flex-1">
              <div className="skeleton w-48 h-6" />
              <div className="skeleton w-32 h-4" />
              <div className="skeleton w-64 h-4" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const friendCount = profile._count.sentRequests + profile._count.receivedRequests;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="animate-fade-in-up">
        {/* Profile header card */}
        <div className="bg-white rounded-3xl shadow-sm border border-court-green-pale/20 overflow-hidden">
          {/* Banner */}
          <div className="h-32 bg-gradient-to-br from-court-green via-court-green-light to-court-green-soft court-pattern relative">
            <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" />
            {/* Decorative ball */}
            <div className="absolute top-4 right-6 w-8 h-8 rounded-full bg-ball-yellow/30 animate-ball-bounce" />
          </div>

          {/* Avatar overlapping banner */}
          <div className="px-8 -mt-12 relative">
            <div className="inline-block ring-4 ring-white rounded-full shadow-lg">
              <Avatar
                name={profile.name}
                image={profile.profileImageUrl}
                size="xl"
              />
            </div>
          </div>

          <div className="px-8 pb-8 pt-4">
            {editing ? (
              <EditForm
                form={form}
                setForm={setForm}
                onSave={handleSave}
                onCancel={() => setEditing(false)}
                saving={saving}
              />
            ) : (
              <>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h1 className="font-display text-2xl font-bold text-gray-900">
                      {profile.name}
                    </h1>
                    <p className="text-gray-500 text-sm">{profile.email}</p>
                  </div>
                  <button onClick={() => setEditing(true)} className="btn-secondary btn-sm">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    Edit
                  </button>
                </div>

                {profile.bio && (
                  <p className="text-gray-600 text-sm leading-relaxed mb-5">{profile.bio}</p>
                )}

                {/* Stats */}
                <div className="flex flex-wrap gap-3 mb-5">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${SURFACE_COLORS[profile.favoriteSurface] || "bg-gray-100 text-gray-700"}`}>
                    {SURFACE_LABELS[profile.favoriteSurface] || profile.favoriteSurface}
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-ball-yellow/20 text-court-green">
                    {SKILL_LABELS[profile.skillLevel] || profile.skillLevel}
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-court-green-pale/20 text-court-green-light">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                    </svg>
                    {friendCount} {friendCount === 1 ? "friend" : "friends"}
                  </span>
                </div>

                <div className="text-xs text-gray-400">
                  Member since {new Date(profile.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Post composer */}
        {!editing && (
          <div className="mt-6">
            <PostComposer
              hideProposeTeam
              onPost={(post) => {
                setProfile({
                  ...profile,
                  posts: [post as Post, ...(profile.posts || [])],
                });
              }}
            />
          </div>
        )}

        {/* Posts section with tabs */}
        {!editing && profile.posts && (() => {
          const findPlayersPosts = profile.posts.filter((p) => p.postType === "find_players");
          const regularPosts = profile.posts.filter((p) => p.postType !== "find_players" && p.mediaType !== "video");
          const videoPosts = profile.posts.filter((p) => p.mediaType === "video");

          const filtered =
            tab === "find_players" ? findPlayersPosts :
            tab === "posts" ? regularPosts :
            videoPosts;

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
                  {findPlayersPosts.length > 0 && (
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tab === "find_players" ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"}`}>
                      {findPlayersPosts.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setTab("posts")}
                  title="Posts"
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl transition-all ${
                    tab === "posts" ? "bg-court-green text-white shadow-md" : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={tab === "posts" ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21,15 16,10 5,21" />
                  </svg>
                  {regularPosts.length > 0 && (
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tab === "posts" ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"}`}>
                      {regularPosts.length}
                    </span>
                  )}
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
                  {videoPosts.length > 0 && (
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tab === "videos" ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"}`}>
                      {videoPosts.length}
                    </span>
                  )}
                </button>
              </div>

              {/* Filtered posts */}
              <div className="space-y-4">
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
                      {tab === "find_players" && "No game posts yet"}
                      {tab === "posts" && "No posts yet. Share your first tennis moment!"}
                      {tab === "videos" && "No videos yet"}
                    </p>
                  </div>
                ) : (
                  filtered.map((post) => <PostCard key={post.id} post={post} />)
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function EditForm({
  form,
  setForm,
  onSave,
  onCancel,
  saving,
}: {
  form: { name: string; bio: string; skillLevel: string; favoriteSurface: string; profileImageUrl: string };
  setForm: (f: typeof form) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError("");
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        setUploadError(data.error || "Upload failed");
        setUploading(false);
        return;
      }

      const { url } = await res.json();
      setForm({ ...form, profileImageUrl: url });
    } catch {
      setUploadError("Upload failed. Please try again.");
    }
    setUploading(false);
  };

  return (
    <div className="space-y-4">
      {/* Photo upload */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">Profile Photo</label>
        <div className="flex items-center gap-5">
          <div className="relative group">
            <div className="w-20 h-20 rounded-full overflow-hidden ring-2 ring-court-green-pale/30 bg-surface">
              {form.profileImageUrl ? (
                <img
                  src={form.profileImageUrl}
                  alt="Preview"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-court-green-soft text-white text-2xl font-bold">
                  {form.name?.charAt(0)?.toUpperCase() || "?"}
                </div>
              )}
            </div>
            {uploading && (
              <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                <svg className="animate-spin w-6 h-6 text-white" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                  <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </div>
            )}
          </div>
          <div className="flex-1">
            <label className="btn-secondary btn-sm cursor-pointer inline-flex">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17,8 12,3 7,8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {uploading ? "Uploading..." : "Upload Photo"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={handleFileUpload}
                disabled={uploading}
                className="hidden"
              />
            </label>
            <p className="text-xs text-gray-400 mt-1.5">JPEG, PNG, GIF, or WebP. Max 5MB.</p>
            {uploadError && (
              <p className="text-xs text-red-500 mt-1">{uploadError}</p>
            )}
            {form.profileImageUrl && (
              <button
                type="button"
                onClick={() => setForm({ ...form, profileImageUrl: "" })}
                className="text-xs text-red-400 hover:text-red-600 mt-1 transition-colors"
              >
                Remove photo
              </button>
            )}
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm"
        />
      </div>
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Bio</label>
        <textarea
          value={form.bio}
          onChange={(e) => setForm({ ...form, bio: e.target.value })}
          rows={3}
          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm resize-none"
          placeholder="Tell the tennis world about yourself..."
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Skill Level</label>
          <select
            value={form.skillLevel}
            onChange={(e) => setForm({ ...form, skillLevel: e.target.value })}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm appearance-none"
          >
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
            <option value="professional">Professional</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Surface</label>
          <select
            value={form.favoriteSurface}
            onChange={(e) => setForm({ ...form, favoriteSurface: e.target.value })}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm appearance-none"
          >
            <option value="hard">Hard Court</option>
            <option value="clay">Clay</option>
            <option value="grass">Grass</option>
            <option value="indoor">Indoor</option>
          </select>
        </div>
      </div>
      <div className="flex items-center gap-3 pt-2">
        <button onClick={onSave} disabled={saving || uploading} className="btn-primary">
          {saving ? "Saving..." : "Save Changes"}
        </button>
        <button onClick={onCancel} className="btn-secondary">
          Cancel
        </button>
      </div>
    </div>
  );
}
