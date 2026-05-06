"use client";

import { useSession, signOut } from "next-auth/react";
import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import Avatar from "@/components/Avatar";
import PostCard from "@/components/PostCard";
import PostComposer from "@/components/PostComposer";
import { AGE_LABELS, GENDER_LABELS, formatRating } from "@/lib/profileLabels";

type Post = {
  id: string;
  content: string;
  mediaUrl?: string;
  mediaType?: string;
  photoUrls?: string[];
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

type Highlight = {
  id: string;
  userId: string;
  mediaUrl: string;
  mediaType: string;
  caption: string;
  createdAt: string;
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
  handle: string | null;
  coverImageUrl: string;
  coverOffsetY: number;
  coverScale: number;
  customTags: string[];
  createdAt: string;
  highlights: Highlight[];
  _count: { sentRequests: number; receivedRequests: number };
  posts: Post[];
};

export default function ProfilePage() {
  const { update: updateSession } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<"find_players" | "posts" | "videos">("find_players");
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    handle: "",
    bio: "",
    skillLevel: "",
    profileImageUrl: "",
    gender: "",
    ageRange: "",
    ratingSystem: "",
    ntrpRating: "" as string | number,
    utrRating: "" as string | number,
    venmoHandle: "",
    paypalHandle: "",
    cashappHandle: "",
    zelleHandle: "",
  });
  const [handleError, setHandleError] = useState("");
  const [saving, setSaving] = useState(false);
  const [bioUploading, setBioUploading] = useState(false);
  const [bioUploadError, setBioUploadError] = useState("");
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverError, setCoverError] = useState("");
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [repositioning, setRepositioning] = useState(false);
  const [draftOffsetY, setDraftOffsetY] = useState(50);
  const [draftScale, setDraftScale] = useState(100);
  const dragStartRef = useRef<{ clientY: number; startOffsetY: number; bannerH: number } | null>(null);
  // Pinch state: active pointers + their starting positions, plus the
  // distance/scale snapshot when pinch began.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{ distance: number; startScale: number } | null>(null);
  const [bioPosted, setBioPosted] = useState<"photo" | "video" | null>(null);
  const [viewingHighlightIdx, setViewingHighlightIdx] = useState<number | null>(null);
  const [addingTag, setAddingTag] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [tagError, setTagError] = useState("");
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
          handle: data.handle || "",
          bio: data.bio,
          skillLevel: data.skillLevel,
          profileImageUrl: data.profileImageUrl,
          gender: data.gender || "",
          ageRange: data.ageRange || "",
          ratingSystem: data.ratingSystem || "",
          ntrpRating: data.ntrpRating ?? "",
          utrRating: data.utrRating ?? "",
          venmoHandle: data.venmoHandle || "",
          paypalHandle: data.paypalHandle || "",
          cashappHandle: data.cashappHandle || "",
          zelleHandle: data.zelleHandle || "",
        });
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setHandleError("");
    const payload: Record<string, unknown> = {
      name: form.name,
      handle: form.handle.trim(),
      bio: form.bio,
      skillLevel: form.skillLevel,
      profileImageUrl: form.profileImageUrl,
      gender: form.gender,
      ageRange: form.ageRange,
      ratingSystem: form.ratingSystem,
      ntrpRating: form.ratingSystem === "ntrp" && form.ntrpRating !== "" ? Number(form.ntrpRating) : null,
      utrRating: form.ratingSystem === "utr" && form.utrRating !== "" ? Number(form.utrRating) : null,
      venmoHandle: form.venmoHandle.trim(),
      paypalHandle: form.paypalHandle.trim(),
      cashappHandle: form.cashappHandle.trim(),
      zelleHandle: form.zelleHandle.trim(),
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
    } else {
      const err = await res.json().catch(() => ({}));
      if (err.field === "handle" && err.error) {
        setHandleError(err.error);
      }
    }
    setSaving(false);
  };

  // Bio-card upload: tapping the "Show your serves..." card opens the file
  // picker. Selected files are uploaded directly and posted as a new post,
  // mirroring PostComposer constraints (10 MB photo, 100 MB video, max 9
  // photos, photos and video are mutually exclusive).
  const handleBioMediaSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setBioUploadError("");
    // Some browsers (notably iOS Safari for .mov) report f.type as "". Fall
    // back to extension so videos still land in the video bucket.
    const VIDEO_EXTS = ["mp4", "webm", "mov", "qt", "m4v"];
    const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp"];
    const kindOf = (f: File): "image" | "video" | "other" => {
      if (f.type.startsWith("image/")) return "image";
      if (f.type.startsWith("video/")) return "video";
      const ext = f.name.split(".").pop()?.toLowerCase() || "";
      if (IMAGE_EXTS.includes(ext)) return "image";
      if (VIDEO_EXTS.includes(ext)) return "video";
      return "other";
    };
    const images = files.filter((f) => kindOf(f) === "image");
    const videos = files.filter((f) => kindOf(f) === "video");
    const others = files.filter((f) => kindOf(f) === "other");
    if (others.length > 0) {
      setBioUploadError("Unsupported file type. Use JPEG/PNG/GIF/WebP for photos or MP4/WebM/MOV for videos.");
      e.target.value = "";
      return;
    }
    if (images.length > 0 && videos.length > 0) {
      setBioUploadError("Photos and videos can't be mixed in one post.");
      e.target.value = "";
      return;
    }
    const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
    const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
    if (images.some((f) => f.size > MAX_PHOTO_BYTES)) {
      setBioUploadError("Photos must be under 10 MB.");
      e.target.value = "";
      return;
    }
    if (videos.some((f) => f.size > MAX_VIDEO_BYTES)) {
      setBioUploadError("Video must be under 100 MB.");
      e.target.value = "";
      return;
    }

    setBioUploading(true);
    try {
      // Each file becomes its own Highlight (Instagram-style) — uploaded to
      // /api/upload first, then registered with /api/highlights. Posts in the
      // feed/profile tabs are unaffected.
      const allFiles = videos.length > 0 ? videos.slice(0, 1) : images.slice(0, 9);
      const newHighlights: Highlight[] = [];
      for (const file of allFiles) {
        const fd = new FormData();
        fd.append("file", file);
        const upRes = await fetch("/api/upload", { method: "POST", body: fd });
        if (!upRes.ok) {
          const data = await upRes.json().catch(() => ({}));
          setBioUploadError(data.error || "Upload failed.");
          continue;
        }
        const upData = await upRes.json();
        const hRes = await fetch("/api/highlights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mediaUrl: upData.url, mediaType: upData.mediaType }),
        });
        if (hRes.ok) {
          newHighlights.push(await hRes.json());
        } else {
          setBioUploadError("Could not save highlight.");
        }
      }
      if (newHighlights.length > 0) {
        setProfile((prev) =>
          prev ? { ...prev, highlights: [...newHighlights, ...(prev.highlights || [])] } : prev
        );
        setBioPosted(videos.length > 0 ? "video" : "photo");
        setTimeout(() => setBioPosted(null), 2200);
      }
    } catch {
      setBioUploadError("Network error. Try again.");
    }
    setBioUploading(false);
    e.target.value = "";
  };

  const handleCoverSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverError("");
    if (!file.type.startsWith("image/")) {
      setCoverError("Cover must be an image.");
      e.target.value = "";
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setCoverError("Cover must be under 10 MB.");
      e.target.value = "";
      return;
    }
    setCoverUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const upRes = await fetch("/api/upload", { method: "POST", body: fd });
      if (!upRes.ok) {
        const data = await upRes.json().catch(() => ({}));
        setCoverError(data.error || "Upload failed.");
        setCoverUploading(false);
        e.target.value = "";
        return;
      }
      const upData = await upRes.json();
      const putRes = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverImageUrl: upData.url, coverOffsetY: 50, coverScale: 100 }),
      });
      if (putRes.ok) {
        const updated = await putRes.json();
        setProfile((prev) => (prev ? { ...prev, coverImageUrl: updated.coverImageUrl || upData.url, coverOffsetY: 50, coverScale: 100 } : prev));
        setDraftOffsetY(50);
        setDraftScale(100);
        setRepositioning(true);
      } else {
        setCoverError("Could not save cover.");
      }
    } catch {
      setCoverError("Network error.");
    }
    setCoverUploading(false);
    e.target.value = "";
  };

  const persistTags = async (tags: string[]) => {
    setProfile((prev) => (prev ? { ...prev, customTags: tags } : prev));
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customTags: tags }),
      });
      if (res.ok) {
        const updated = await res.json();
        setProfile((prev) => (prev ? { ...prev, customTags: updated.customTags || [] } : prev));
      }
    } catch {}
  };

  const addTag = async () => {
    const t = newTag.trim();
    if (!t) return;
    if (t.length > 30) {
      setTagError("Tags must be 30 characters or fewer.");
      return;
    }
    const current = profile?.customTags || [];
    if (current.length >= 10) {
      setTagError("You can have up to 10 tags.");
      return;
    }
    if (current.includes(t)) {
      setTagError("That tag is already on your profile.");
      return;
    }
    setTagError("");
    setNewTag("");
    setAddingTag(false);
    await persistTags([...current, t]);
  };

  const removeTag = async (tag: string) => {
    const next = (profile?.customTags || []).filter((t) => t !== tag);
    await persistTags(next);
  };

  const startRepositioning = () => {
    setDraftOffsetY(profile?.coverOffsetY ?? 50);
    setDraftScale(profile?.coverScale ?? 100);
    setRepositioning(true);
  };

  const distanceBetween = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  };

  const handleCoverDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!repositioning) return;
    // Skip chrome (Save/Cancel/slider) so they get their own click events.
    const targetEl = e.target as HTMLElement;
    if (targetEl.closest("button") || targetEl.closest("input")) return;
    e.preventDefault();
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);

    if (pointersRef.current.size === 2) {
      // Switch into pinch mode.
      const [a, b] = Array.from(pointersRef.current.values());
      pinchStartRef.current = {
        distance: distanceBetween(a, b),
        startScale: draftScale,
      };
      dragStartRef.current = null;
    } else if (pointersRef.current.size === 1) {
      const rect = e.currentTarget.getBoundingClientRect();
      dragStartRef.current = {
        clientY: e.clientY,
        startOffsetY: draftOffsetY,
        bannerH: rect.height,
      };
      pinchStartRef.current = null;
    }
  };

  const handleCoverDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!repositioning) return;
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Pinch — two fingers
    if (pointersRef.current.size === 2 && pinchStartRef.current) {
      const [a, b] = Array.from(pointersRef.current.values());
      const dist = distanceBetween(a, b);
      const ratio = dist / pinchStartRef.current.distance;
      const next = Math.max(100, Math.min(300, Math.round(pinchStartRef.current.startScale * ratio)));
      setDraftScale(next);
      return;
    }

    // Drag — single pointer
    if (pointersRef.current.size === 1 && dragStartRef.current) {
      const { clientY, startOffsetY, bannerH } = dragStartRef.current;
      const delta = (e.clientY - clientY) / bannerH * 100 * 1.5;
      const next = Math.max(0, Math.min(100, startOffsetY - delta));
      setDraftOffsetY(next);
    }
  };

  const handleCoverDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!repositioning) return;
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.delete(e.pointerId);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}

    if (pointersRef.current.size < 2) pinchStartRef.current = null;
    if (pointersRef.current.size === 1) {
      // Re-anchor drag start to the remaining pointer so the gesture continues smoothly.
      const remaining = Array.from(pointersRef.current.values())[0];
      const rect = e.currentTarget.getBoundingClientRect();
      dragStartRef.current = {
        clientY: remaining.y,
        startOffsetY: draftOffsetY,
        bannerH: rect.height,
      };
    }
    if (pointersRef.current.size === 0) dragStartRef.current = null;
  };

  const saveCoverOffset = async () => {
    const offsetY = Math.round(draftOffsetY);
    const scale = Math.round(draftScale);
    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coverOffsetY: offsetY, coverScale: scale }),
    });
    if (res.ok) {
      setProfile((prev) => (prev ? { ...prev, coverOffsetY: offsetY, coverScale: scale } : prev));
      setRepositioning(false);
    } else {
      setCoverError("Could not save framing.");
    }
  };

  const cancelRepositioning = () => {
    setDraftOffsetY(profile?.coverOffsetY ?? 50);
    setDraftScale(profile?.coverScale ?? 100);
    setRepositioning(false);
    pointersRef.current.clear();
    dragStartRef.current = null;
    pinchStartRef.current = null;
  };

  const deleteHighlight = async (id: string) => {
    if (!confirm("Remove this highlight?")) return;
    const res = await fetch(`/api/highlights/${id}`, { method: "DELETE" });
    if (res.ok) {
      setProfile((prev) =>
        prev ? { ...prev, highlights: (prev.highlights || []).filter((h) => h.id !== id) } : prev
      );
      setViewingHighlightIdx(null);
    }
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
          {/* Banner — user-uploaded cover (img with object-position so we can
              reposition vertically without re-uploading), gradient fallback. */}
          <div
            onPointerDown={handleCoverDragStart}
            onPointerMove={handleCoverDragMove}
            onPointerUp={handleCoverDragEnd}
            onPointerCancel={handleCoverDragEnd}
            className={`h-32 relative overflow-hidden select-none ${
              repositioning ? "cursor-grabbing" : ""
            } ${profile.coverImageUrl ? "" : "bg-gradient-to-br from-court-green via-court-green-light to-court-green-soft court-pattern"}`}
            style={{ touchAction: repositioning ? "none" : undefined }}
          >
            {profile.coverImageUrl ? (
              <img
                src={profile.coverImageUrl}
                alt=""
                draggable={false}
                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                style={{
                  objectPosition: `center ${repositioning ? draftOffsetY : profile.coverOffsetY}%`,
                  transform: `scale(${(repositioning ? draftScale : (profile.coverScale ?? 100)) / 100})`,
                  transformOrigin: "center",
                }}
              />
            ) : (
              <>
                <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" />
                <div className="absolute top-4 right-6 w-8 h-8 rounded-full bg-ball-yellow/30 animate-ball-bounce" />
              </>
            )}
            {profile.coverImageUrl && !repositioning && (
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent pointer-events-none" />
            )}
            {repositioning && (
              <>
                <div className="absolute inset-0 bg-black/20 pointer-events-none flex items-center justify-center">
                  <p className="text-white text-xs font-semibold bg-black/50 backdrop-blur px-3 py-1 rounded-full">
                    Drag · pinch · or use the slider
                  </p>
                </div>
                {/* Zoom slider — top center, above the drag area */}
                <div
                  className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 bg-black/50 backdrop-blur px-3 py-1.5 rounded-full"
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerMove={(e) => e.stopPropagation()}
                  onPointerUp={(e) => e.stopPropagation()}
                >
                  <span className="text-white text-[10px] font-bold">1×</span>
                  <input
                    type="range"
                    min={100}
                    max={300}
                    step={5}
                    value={draftScale}
                    onChange={(e) => setDraftScale(Number(e.target.value))}
                    className="w-32 accent-court-green"
                    aria-label="Zoom"
                  />
                  <span className="text-white text-[10px] font-bold">3×</span>
                </div>
              </>
            )}

            {/* Edit cover button (only when not repositioning) */}
            {!repositioning && (
              <>
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  disabled={coverUploading}
                  className="absolute bottom-3 right-3 z-10 w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur text-white flex items-center justify-center transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  title="Change cover photo"
                  aria-label="Change cover photo"
                >
                  {coverUploading ? (
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                      <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                  )}
                </button>
                {profile.coverImageUrl && (
                  <button
                    type="button"
                    onClick={startRepositioning}
                    className="absolute bottom-3 right-14 z-10 w-8 h-8 rounded-full bg-black/25 hover:bg-black/45 backdrop-blur text-white/80 hover:text-white flex items-center justify-center transition-colors"
                    title="Edit cover"
                    aria-label="Edit cover"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                )}
              </>
            )}

            {/* Save/Cancel chrome while repositioning */}
            {repositioning && (
              <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2">
                <button
                  type="button"
                  onClick={cancelRepositioning}
                  className="px-3 h-9 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur text-white text-xs font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveCoverOffset}
                  className="px-3 h-9 rounded-full bg-court-green hover:bg-court-green-light text-white text-xs font-bold transition-colors"
                >
                  Save
                </button>
              </div>
            )}

            <input
              ref={coverInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              onChange={handleCoverSelect}
              disabled={coverUploading}
              className="hidden"
            />
          </div>
          {coverError && (
            <p className="text-xs text-red-600 px-8 pt-2">{coverError}</p>
          )}

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
                handleError={handleError}
              />
            ) : (
              <>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h1 className="font-display text-2xl font-bold text-gray-900">
                      {profile.name}
                    </h1>
                    {profile.handle && (
                      <p className="text-gray-500 text-sm font-medium">@{profile.handle}</p>
                    )}
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

                {/* Stats — typed chips are tappable shortcuts into Edit;
                    custom tags inline-editable; + Add tag pill at the end. */}
                <div className="flex flex-wrap gap-2 mb-5">
                  {formatRating(profile) && (
                    <button
                      onClick={() => setEditing(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-ball-yellow/20 text-court-green hover:bg-ball-yellow/30 transition-colors"
                      title="Edit rating"
                    >
                      {formatRating(profile)}
                    </button>
                  )}
                  {profile.ageRange && (
                    <button
                      onClick={() => setEditing(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                      title="Edit age range"
                    >
                      {AGE_LABELS[profile.ageRange] || profile.ageRange}
                    </button>
                  )}
                  {profile.gender && (
                    <button
                      onClick={() => setEditing(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                      title="Edit gender"
                    >
                      {GENDER_LABELS[profile.gender] || profile.gender}
                    </button>
                  )}
                  {(profile.customTags || []).map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 pl-3 pr-2 py-1.5 rounded-full text-xs font-semibold bg-court-green-pale/15 text-court-green-light"
                    >
                      {tag}
                      <button
                        onClick={() => removeTag(tag)}
                        className="ml-0.5 w-4 h-4 rounded-full text-court-green-light/60 hover:text-red-500 hover:bg-white/60 flex items-center justify-center transition-colors"
                        title="Remove tag"
                        aria-label={`Remove ${tag}`}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </span>
                  ))}
                  {addingTag ? (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-white border border-court-green-pale/60">
                      <input
                        type="text"
                        autoFocus
                        value={newTag}
                        onChange={(e) => { setNewTag(e.target.value); setTagError(""); }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); addTag(); }
                          if (e.key === "Escape") { setAddingTag(false); setNewTag(""); setTagError(""); }
                        }}
                        maxLength={30}
                        placeholder="e.g. Seattle"
                        className="bg-transparent text-xs font-semibold outline-none w-24 min-w-0 placeholder:text-gray-400 placeholder:font-normal"
                      />
                      <button
                        onClick={addTag}
                        className="text-court-green hover:text-court-green-light"
                        title="Add"
                        aria-label="Add tag"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                          <polyline points="20,6 9,17 4,12" />
                        </svg>
                      </button>
                      <button
                        onClick={() => { setAddingTag(false); setNewTag(""); setTagError(""); }}
                        className="text-gray-400 hover:text-gray-600"
                        title="Cancel"
                        aria-label="Cancel adding tag"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </span>
                  ) : (
                    (profile.customTags?.length ?? 0) < 10 && (
                      <button
                        onClick={() => { setAddingTag(true); setTagError(""); }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border border-dashed border-court-green-pale/70 text-court-green-light hover:bg-court-green-pale/15 transition-colors"
                        title="Add a tag"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        Add tag
                      </button>
                    )
                  )}
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-court-green-pale/20 text-court-green-light">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                    </svg>
                    {friendCount} {friendCount === 1 ? "friend" : "friends"}
                  </span>
                </div>
                {tagError && (
                  <p className="text-xs text-red-600 -mt-3 mb-3">{tagError}</p>
                )}

                <div className="mt-4 -mx-2 px-2 flex gap-3 overflow-x-auto scrollbar-hide">
                  <label
                    className={`shrink-0 cursor-pointer ${bioUploading ? "opacity-60 pointer-events-none" : ""}`}
                    aria-label="Add highlight"
                    title="Add highlight"
                  >
                    <div className="w-16 h-16 rounded-full border-2 border-dashed border-court-green-pale/70 bg-court-green-pale/10 hover:bg-court-green-pale/25 flex items-center justify-center text-court-green transition-colors">
                      {bioUploading ? (
                        <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                          <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                        </svg>
                      ) : (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                      )}
                    </div>
                    <input
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,video/mov"
                      onChange={handleBioMediaSelect}
                      disabled={bioUploading}
                      className="hidden"
                    />
                  </label>

                  {profile.highlights && profile.highlights.map((h, idx) => (
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
                {bioUploadError && (
                  <p className="text-xs text-red-600 mt-2">{bioUploadError}</p>
                )}
                {bioPosted && (
                  <p className="text-xs text-green-600 font-semibold mt-2">
                    ✓ Added.
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {viewingHighlightIdx !== null && profile.highlights && profile.highlights[viewingHighlightIdx] && createPortal(
          <HighlightViewer
            highlights={profile.highlights}
            index={viewingHighlightIdx}
            onClose={() => setViewingHighlightIdx(null)}
            onPrev={() => setViewingHighlightIdx((i) => (i === null ? 0 : (i - 1 + profile.highlights.length) % profile.highlights.length))}
            onNext={() => setViewingHighlightIdx((i) => (i === null ? 0 : (i + 1) % profile.highlights.length))}
            onDelete={() => deleteHighlight(profile.highlights[viewingHighlightIdx].id)}
          />,
          document.body
        )}

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
          // Find Players tab: every game-related post (find_players or
          // propose_team — regardless of media or completion state), plus any
          // text-only general post. Photos / Videos tabs are visual-content
          // only — game posts never appear there even if they carry an image.
          const isGamePost = (p: { postType?: string }) =>
            p.postType === "find_players" || p.postType === "propose_team";
          const findPlayersPosts = profile.posts.filter((p) =>
            isGamePost(p) || (!p.mediaUrl && p.mediaType !== "image" && p.mediaType !== "video")
          );
          const photoPosts = profile.posts.filter((p) => p.mediaType === "image" && !isGamePost(p));
          const videoPosts = profile.posts.filter((p) => p.mediaType === "video" && !isGamePost(p));

          const filtered =
            tab === "find_players" ? findPlayersPosts :
            tab === "posts" ? photoPosts :
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

              {/* Filtered posts */}
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
                    {tab === "find_players" && "No text posts yet"}
                    {tab === "posts" && "No photos yet. Share your first tennis moment!"}
                    {tab === "videos" && "No videos yet"}
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
                  {filtered.map((post) => <PostCard key={post.id} post={post} />)}
                </div>
              )}
            </div>
          );
        })()}

        {selectedPostId && (() => {
          const post = profile.posts.find((p) => p.id === selectedPostId);
          if (!post) return null;
          return (
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
                <PostCard post={post} />
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function HighlightViewer({
  highlights,
  index,
  onClose,
  onPrev,
  onNext,
  onDelete,
}: {
  highlights: Highlight[];
  index: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onDelete: () => void;
}) {
  // Lock body scroll while open so the page underneath doesn't move.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const h = highlights[index];
  if (!h) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] bg-black/95 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
        aria-label="Close"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      {highlights.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); onPrev(); }}
            className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
            aria-label="Previous"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onNext(); }}
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
        <button
          onClick={onDelete}
          className="absolute top-3 left-3 w-8 h-8 rounded-full bg-black/30 hover:bg-black/50 text-white/70 hover:text-white flex items-center justify-center transition-colors"
          aria-label="Delete highlight"
          title="Delete highlight"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
          </svg>
        </button>
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
  handleError,
}: {
  form: {
    name: string;
    handle: string;
    bio: string;
    skillLevel: string;
    profileImageUrl: string;
    gender: string;
    ageRange: string;
    ratingSystem: string;
    ntrpRating: string | number;
    utrRating: string | number;
    venmoHandle: string;
    paypalHandle: string;
    cashappHandle: string;
    zelleHandle: string;
  };
  setForm: (f: typeof form) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  handleError?: string;
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
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Handle</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">@</span>
          <input
            type="text"
            value={form.handle}
            onChange={(e) => setForm({ ...form, handle: e.target.value.replace(/^@+/, "") })}
            className={`w-full pl-7 pr-4 py-2.5 border rounded-xl text-sm ${handleError ? "border-red-300" : "border-gray-200"}`}
            placeholder="your_handle"
            maxLength={20}
          />
        </div>
        {handleError ? (
          <p className="text-[11px] text-red-600 mt-1">{handleError}</p>
        ) : (
          <p className="text-[11px] text-gray-400 mt-1">3–20 characters: letters, numbers, dot, underscore. Leave blank to remove.</p>
        )}
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
      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1.5">
          Payment handles <span className="font-normal text-gray-400">(optional — used to settle shared costs)</span>
        </label>
        <div className="space-y-2">
          <input
            type="text"
            value={form.venmoHandle}
            onChange={(e) => setForm({ ...form, venmoHandle: e.target.value })}
            placeholder="Venmo username (e.g. jane-doe)"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm"
          />
          <input
            type="text"
            value={form.paypalHandle}
            onChange={(e) => setForm({ ...form, paypalHandle: e.target.value })}
            placeholder="PayPal.me username"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm"
          />
          <input
            type="text"
            value={form.cashappHandle}
            onChange={(e) => setForm({ ...form, cashappHandle: e.target.value })}
            placeholder="Cash App $cashtag"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm"
          />
          <input
            type="text"
            value={form.zelleHandle}
            onChange={(e) => setForm({ ...form, zelleHandle: e.target.value })}
            placeholder="Zelle phone or email"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm"
          />
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
