"use client";

import { useSession, signOut } from "next-auth/react";
import { useEffect, useState, useRef } from "react";
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
  gender: string;
  ageRange: string;
  ratingSystem: string;
  ntrpRating: number | null;
  utrRating: number | null;
  createdAt: string;
  _count: { sentRequests: number; receivedRequests: number };
  posts: Post[];
};

const GENDER_LABELS: Record<string, string> = {
  male: "Male",
  female: "Female",
  non_binary: "Non-binary",
  prefer_not_to_say: "Prefer not to say",
};

const AGE_LABELS: Record<string, string> = {
  under_18: "Under 18",
  "18_29": "18–29",
  "30_49": "30–49",
  "50_plus": "50+",
};

function formatRating(p: Pick<Profile, "ratingSystem" | "ntrpRating" | "utrRating" | "skillLevel">): string {
  if (p.ratingSystem === "ntrp" && p.ntrpRating != null) return `NTRP ${p.ntrpRating.toFixed(1)}`;
  if (p.ratingSystem === "utr" && p.utrRating != null) return `UTR ${p.utrRating.toFixed(2)}`;
  if (p.ratingSystem === "self") return SKILL_LABELS[p.skillLevel] || p.skillLevel;
  return "";
}

const SKILL_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  professional: "Professional",
};

export default function ProfilePage() {
  const { update: updateSession } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<"find_players" | "posts" | "videos">("find_players");
  const [form, setForm] = useState({
    name: "",
    bio: "",
    skillLevel: "",
    profileImageUrl: "",
    gender: "",
    ageRange: "",
    ratingSystem: "",
    ntrpRating: "" as string | number,
    utrRating: "" as string | number,
  });
  const [saving, setSaving] = useState(false);
  const [isNative, setIsNative] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsNative(!!(window as unknown as { Capacitor?: unknown }).Capacitor);
  }, []);

  // Click-outside + Escape to close the options menu
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data) => {
        setProfile(data);
        setForm({
          name: data.name,
          bio: data.bio,
          skillLevel: data.skillLevel,
          profileImageUrl: data.profileImageUrl,
          gender: data.gender || "",
          ageRange: data.ageRange || "",
          ratingSystem: data.ratingSystem || "",
          ntrpRating: data.ntrpRating ?? "",
          utrRating: data.utrRating ?? "",
        });
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const payload: Record<string, unknown> = {
      name: form.name,
      bio: form.bio,
      skillLevel: form.skillLevel,
      profileImageUrl: form.profileImageUrl,
      gender: form.gender,
      ageRange: form.ageRange,
      ratingSystem: form.ratingSystem,
      ntrpRating: form.ratingSystem === "ntrp" && form.ntrpRating !== "" ? Number(form.ntrpRating) : null,
      utrRating: form.ratingSystem === "utr" && form.utrRating !== "" ? Number(form.utrRating) : null,
    };
    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const updated = await res.json();
      setProfile({ ...profile!, ...updated });
      setEditing(false);
      await updateSession();
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
                  {isNative ? (
                    <button onClick={() => setEditing(true)} className="btn-secondary btn-sm">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                      Edit
                    </button>
                  ) : (
                    <div ref={menuRef} className="relative">
                      <button
                        onClick={() => setMenuOpen((o) => !o)}
                        className="btn-secondary btn-sm"
                        aria-label="Profile options"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <circle cx="12" cy="5" r="1.75" />
                          <circle cx="12" cy="12" r="1.75" />
                          <circle cx="12" cy="19" r="1.75" />
                        </svg>
                      </button>
                      {menuOpen && (
                        <div
                          role="menu"
                          className="absolute right-0 top-full mt-2 w-44 bg-white rounded-xl shadow-lg border border-gray-200 py-1 z-50"
                        >
                          <button
                            role="menuitem"
                            onClick={() => {
                              setMenuOpen(false);
                              setEditing(true);
                            }}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                            Edit Profile
                          </button>
                          <button
                            role="menuitem"
                            onClick={() => {
                              setMenuOpen(false);
                              signOut({ callbackUrl: "/login" });
                            }}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 border-t border-gray-100"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                              <polyline points="16,17 21,12 16,7" />
                              <line x1="21" y1="12" x2="9" y2="12" />
                            </svg>
                            Sign out
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {profile.bio && (
                  <p className="text-gray-600 text-sm leading-relaxed mb-5">{profile.bio}</p>
                )}

                {/* Stats */}
                <div className="flex flex-wrap gap-3 mb-5">
                  {formatRating(profile) && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-ball-yellow/20 text-court-green">
                      {formatRating(profile)}
                    </span>
                  )}
                  {profile.ageRange && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                      {AGE_LABELS[profile.ageRange] || profile.ageRange}
                    </span>
                  )}
                  {profile.gender && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                      {GENDER_LABELS[profile.gender] || profile.gender}
                    </span>
                  )}
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
  form: {
    name: string;
    bio: string;
    skillLevel: string;
    profileImageUrl: string;
    gender: string;
    ageRange: string;
    ratingSystem: string;
    ntrpRating: string | number;
    utrRating: string | number;
  };
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
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Gender</label>
          <select
            value={form.gender}
            onChange={(e) => setForm({ ...form, gender: e.target.value })}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm appearance-none"
          >
            <option value="">—</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="non_binary">Non-binary</option>
            <option value="prefer_not_to_say">Prefer not to say</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Age range</label>
          <select
            value={form.ageRange}
            onChange={(e) => setForm({ ...form, ageRange: e.target.value })}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm appearance-none"
          >
            <option value="">—</option>
            <option value="under_18">Under 18</option>
            <option value="18_29">18–29</option>
            <option value="30_49">30–49</option>
            <option value="50_plus">50+</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Rating system</label>
        <select
          value={form.ratingSystem}
          onChange={(e) => setForm({ ...form, ratingSystem: e.target.value })}
          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm appearance-none"
        >
          <option value="">—</option>
          <option value="ntrp">USTA / NTRP</option>
          <option value="utr">UTR</option>
          <option value="self">Self-rated</option>
        </select>
        {form.ratingSystem === "ntrp" && (
          <input
            type="number"
            step={0.5}
            min={2.5}
            max={7.0}
            value={form.ntrpRating}
            onChange={(e) => setForm({ ...form, ntrpRating: e.target.value })}
            placeholder="NTRP (2.5 – 7.0)"
            className="mt-2 w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm"
          />
        )}
        {form.ratingSystem === "utr" && (
          <input
            type="number"
            step={0.01}
            min={1}
            max={16.5}
            value={form.utrRating}
            onChange={(e) => setForm({ ...form, utrRating: e.target.value })}
            placeholder="UTR (1.0 – 16.5)"
            className="mt-2 w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm"
          />
        )}
        {form.ratingSystem === "self" && (
          <select
            value={form.skillLevel}
            onChange={(e) => setForm({ ...form, skillLevel: e.target.value })}
            className="mt-2 w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm appearance-none"
          >
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
            <option value="professional">Professional</option>
          </select>
        )}
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
