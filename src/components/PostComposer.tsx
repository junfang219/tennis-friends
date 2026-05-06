"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useSession } from "next-auth/react";
import Avatar from "./Avatar";
import EmojiPicker from "./EmojiPicker";

const PLACEHOLDERS = [
  "Just finished a great match...",
  "Looking for a doubles partner this weekend...",
  "Finally nailed that serve!",
  "Anyone up for a rally session?",
  "Court conditions are perfect today...",
];

type GroupOption = {
  id: string;
  name: string;
  _count: { members: number };
};

export default function PostComposer({
  onPost,
  hideProposeTeam = false,
}: {
  onPost: (post: Record<string, unknown>) => void;
  hideProposeTeam?: boolean;
}) {
  const { data: session } = useSession();
  const [showModal, setShowModal] = useState(false);
  const [openWithFindPlayers, setOpenWithFindPlayers] = useState(false);
  const [openWithProposeTeam, setOpenWithProposeTeam] = useState(false);
  const [placeholder] = useState(
    () => PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)]
  );
  const [isNative, setIsNative] = useState(false);
  useEffect(() => {
    setIsNative(!!(window as unknown as { Capacitor?: unknown }).Capacitor);
  }, []);

  const openModal = (findPlayers = false, proposeTeam = false) => {
    setOpenWithFindPlayers(findPlayers);
    setOpenWithProposeTeam(proposeTeam);
    setShowModal(true);
  };

  return (
    <>
      {/* Trigger bar — always visible in feed */}
      <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 overflow-hidden">
        <div className="p-4 flex items-center gap-3">
          <Avatar
            name={session?.user?.name || ""}
            image={session?.user?.image}
            size="md"
          />
          <button
            onClick={() => openModal(false)}
            className={`flex-1 min-w-0 text-left px-4 py-2.5 bg-surface/60 hover:bg-surface rounded-xl text-sm text-gray-400 transition-colors ${isNative ? "truncate" : ""}`}
          >
            {placeholder}
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => openModal(false)}
              className="p-2 rounded-lg text-gray-400 hover:text-court-green-soft hover:bg-court-green-soft/8 transition-colors"
              title="Photo"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21,15 16,10 5,21" />
              </svg>
            </button>
            <button
              onClick={() => openModal(false)}
              className="p-2 rounded-lg text-gray-400 hover:text-court-green-soft hover:bg-court-green-soft/8 transition-colors"
              title="Video"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23,7 16,12 23,17" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </button>
          </div>
        </div>

        {/* CTA buttons row */}
        <div className="flex border-t border-court-green-pale/30">
          {/* Find Players CTA — primary, larger */}
          <button
            onClick={() => openModal(true, false)}
            className={`flex items-center justify-center gap-2 px-3 py-3 bg-gradient-to-r from-court-green to-court-green-light text-white font-semibold text-xs sm:text-sm hover:from-court-green-light hover:to-court-green-soft transition-all ${hideProposeTeam ? "w-full" : "flex-[2]"}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="shrink-0">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            Find Players for a Game
          </button>

          {/* Propose Team CTA — secondary, smaller */}
          {!hideProposeTeam && (
            <button
              onClick={() => openModal(false, true)}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-3 bg-gradient-to-r from-clay to-clay-light text-white font-semibold text-xs hover:opacity-90 transition-all border-l border-white/20"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M6 9H4.5a2.5 2.5 0 010-5H6" />
                <path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
                <path d="M4 22h16" />
                <path d="M18 2H6v7a6 6 0 0012 0V2z" />
              </svg>
              Propose Team
            </button>
          )}
        </div>
      </div>

      {/* Full-screen modal composer — rendered via portal to escape all parent containers */}
      {showModal && createPortal(
        <ComposerModal
          session={session}
          placeholder={placeholder}
          initialFindPlayers={openWithFindPlayers}
          initialProposeTeam={openWithProposeTeam}
          onPost={(post) => {
            onPost(post);
            setShowModal(false);
          }}
          onClose={() => { setShowModal(false); setOpenWithFindPlayers(false); setOpenWithProposeTeam(false); }}
        />,
        document.body
      )}
    </>
  );
}

/* ────── Modal Composer ────── */

function ComposerModal({
  session,
  placeholder,
  initialFindPlayers,
  initialProposeTeam,
  onPost,
  onClose,
}: {
  session: ReturnType<typeof useSession>["data"];
  placeholder: string;
  initialFindPlayers?: boolean;
  initialProposeTeam?: boolean;
  onPost: (post: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [content, setContent] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");
  // Up to 9 photos per post (images only). Videos are single-attachment and
  // tracked via mediaUrl + mediaType — image and video are mutually exclusive.
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaType, setMediaType] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const MAX_PHOTOS = 9;
  const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB — matches /api/upload
  const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB — matches /api/upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const teamPurposeRef = useRef<HTMLTextAreaElement>(null);

  // Audience
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [friendGroups, setFriendGroups] = useState<GroupOption[]>([]);
  const [selectedFriendGroupIds, setSelectedFriendGroupIds] = useState<Set<string>>(new Set());
  const [showAudiencePicker, setShowAudiencePicker] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const insertEmoji = (emoji: string) => {
    // When propose-team form is active, insert into teamPurpose; otherwise into content
    const isTeam = proposeTeam;
    const el = isTeam ? teamPurposeRef.current : textareaRef.current;
    const setter = isTeam ? setTeamPurpose : setContent;
    if (!el) {
      setter((prev) => prev + emoji);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + emoji + el.value.slice(end);
    setter(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  };

  // Find Players
  const [findPlayers, setFindPlayers] = useState(initialFindPlayers || false);
  const [playDate, setPlayDate] = useState("");
  const [playTime, setPlayTime] = useState("");
  const [courtLocation, setCourtLocation] = useState("");
  const [gameType, setGameType] = useState("singles");
  const [playersNeeded, setPlayersNeeded] = useState(1);
  const [skillBucket, setSkillBucket] = useState<"any" | "beginner" | "intermediate" | "advanced" | "pro">("any");
  const [playDuration, setPlayDuration] = useState(90);
  const [courtBooked, setCourtBooked] = useState(false);

  // Propose Team fields
  const [proposeTeam, setProposeTeam] = useState(initialProposeTeam || false);
  const [teamName, setTeamName] = useState("");
  const [teamPurpose, setTeamPurpose] = useState("");
  const [teamSize, setTeamSize] = useState(4);
  const [teamType, setTeamType] = useState("casual");
  const [teamSchedule, setTeamSchedule] = useState("");
  const [skillSystem, setSkillSystem] = useState<"NTRP" | "UTR">("NTRP");
  const [skillMin, setSkillMin] = useState("3.0");
  const [skillMax, setSkillMax] = useState("4.0");

  useEffect(() => {
    fetch("/api/groups")
      .then((r) => r.json())
      .then((data) => setGroups(Array.isArray(data) ? data : []));
    fetch("/api/friend-groups")
      .then((r) => r.json())
      .then((data) => setFriendGroups(Array.isArray(data) ? data : []));
  }, []);

  // Auto-focus textarea
  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, []);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const toggleGroup = (id: string) => {
    const next = new Set(selectedGroupIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedGroupIds(next);
  };

  const toggleFriendGroup = (id: string) => {
    const next = new Set(selectedFriendGroupIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedFriendGroupIds(next);
  };

  const selectAllFriends = () => {
    setSelectedGroupIds(new Set());
    setSelectedFriendGroupIds(new Set());
  };

  const audienceLabel = (selectedGroupIds.size === 0 && selectedFriendGroupIds.size === 0)
    ? "All Friends"
    : [
        ...groups.filter((g) => selectedGroupIds.has(g.id)).map((g) => g.name),
        ...friendGroups.filter((g) => selectedFriendGroupIds.has(g.id)).map((g) => g.name),
      ].join(", ");

  // Upload a single file. Used for the video button.
  const uploadOne = async (file: File): Promise<{ url: string; mediaType: string } | null> => {
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setUploadError(data.error || "Upload failed");
        return null;
      }
      return await res.json();
    } catch {
      setUploadError("Upload failed. Please try again.");
      return null;
    }
  };

  // Photo button: multi-file. Uploads in parallel, appends image URLs to
  // photoUrls (capped at MAX_PHOTOS). Rejects if a video is mixed in or any
  // file exceeds MAX_PHOTO_BYTES (skipped with a count).
  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (mediaUrl && mediaType === "video") {
      setUploadError("Remove the video before adding photos.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const remaining = MAX_PHOTOS - photoUrls.length;
    if (remaining <= 0) {
      setUploadError(`Up to ${MAX_PHOTOS} photos per post.`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const ok = files.filter((f) => f.size <= MAX_PHOTO_BYTES);
    const oversized = files.length - ok.length;
    const toUpload = ok.slice(0, remaining);
    setUploadError("");
    if (toUpload.length === 0) {
      if (oversized > 0) {
        setUploadError(`Photo${oversized === 1 ? "" : "s"} must be under 10 MB.`);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setUploading(true);
    const results = await Promise.all(toUpload.map((f) => uploadOne(f)));
    const newImageUrls = results
      .filter((r): r is { url: string; mediaType: string } => !!r && r.mediaType === "image")
      .map((r) => r.url);
    if (newImageUrls.length > 0) {
      setPhotoUrls((prev) => [...prev, ...newImageUrls]);
    }
    if (results.some((r) => r && r.mediaType !== "image")) {
      setUploadError("Use the video button for videos.");
    } else if (oversized > 0) {
      setUploadError(
        `Skipped ${oversized} photo${oversized === 1 ? "" : "s"} over 10 MB.`
      );
    } else if (ok.length > toUpload.length) {
      setUploadError(`Only the first ${toUpload.length} photo(s) added (max ${MAX_PHOTOS}).`);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Video button: single-file. Replaces any existing video; rejects if photos
  // are already attached or the file exceeds MAX_VIDEO_BYTES.
  const handleVideoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (photoUrls.length > 0) {
      setUploadError("Remove photos before adding a video.");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setUploadError("Video must be under 100 MB.");
      e.target.value = "";
      return;
    }
    setUploadError("");
    setUploading(true);
    const result = await uploadOne(file);
    if (result) {
      setMediaUrl(result.url);
      setMediaType(result.mediaType);
    }
    setUploading(false);
    e.target.value = "";
  };

  const removePhotoAt = (idx: number) => {
    setPhotoUrls((prev) => prev.filter((_, i) => i !== idx));
    setUploadError("");
  };

  const removeVideo = () => {
    setMediaUrl("");
    setMediaType("");
    setUploadError("");
  };

  const canSubmit = findPlayers
    ? (playDate && playTime && courtLocation)
    : proposeTeam
    ? (teamName.trim() && teamPurpose.trim())
    : (content.trim() || photoUrls.length > 0 || mediaUrl);

  const handleSubmit = async () => {
    if (!canSubmit || posting || uploading) return;
    setPosting(true);
    setPostError("");

    const body: Record<string, unknown> = {
      content,
      // For photo posts, send the array; the API maps photoUrls[0] into
      // mediaUrl + mediaType="image" for backwards compat. For videos,
      // continue sending mediaUrl + mediaType.
      photoUrls: photoUrls.length > 0 ? photoUrls : undefined,
      mediaUrl: photoUrls.length > 0 ? "" : mediaUrl,
      mediaType: photoUrls.length > 0 ? "" : mediaType,
      groupIds: selectedGroupIds.size > 0 ? Array.from(selectedGroupIds) : undefined,
      friendGroupIds: selectedFriendGroupIds.size > 0 ? Array.from(selectedFriendGroupIds) : undefined,
    };

    if (findPlayers) {
      body.postType = "find_players";
      body.playDate = playDate;
      body.playTime = playTime;
      body.courtLocation = courtLocation;
      body.gameType = gameType;
      body.playersNeeded = playersNeeded;
      body.playDuration = playDuration;
      body.courtBooked = courtBooked;
      const bucketRanges: Record<typeof skillBucket, [number, number] | null> = {
        any: null,
        beginner: [2.5, 3.0],
        intermediate: [3.0, 4.0],
        advanced: [4.0, 5.0],
        pro: [5.0, 7.0],
      };
      const range = bucketRanges[skillBucket];
      if (range) {
        body.skillMin = range[0];
        body.skillMax = range[1];
      }
      if (!content.trim()) {
        body.content = `Looking for ${playersNeeded} ${playersNeeded === 1 ? "player" : "players"} for ${gameType} at ${courtLocation} on ${playDate} at ${playTime} (${playDuration} min)`;
      }
    }

    if (proposeTeam) {
      body.postType = "propose_team";
      body.courtLocation = teamName;
      body.gameType = teamType;
      body.playDate = teamSchedule || undefined;
      body.playTime = `${skillSystem}:${skillMin}-${skillMax}`;
      body.playersNeeded = teamSize;
      body.content = teamPurpose;
    }

    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const post = await res.json();
        onPost(post);
      } else {
        let msg = `Post failed (${res.status})`;
        try {
          const data = await res.json();
          if (data?.error) msg = data.error;
        } catch {}
        setPostError(msg);
      }
    } catch (err) {
      setPostError(err instanceof Error ? err.message : "Network error");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10000] bg-black/50 flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-lg sm:rounded-2xl shadow-2xl min-h-screen sm:min-h-0 sm:my-8 flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:pt-0 sm:pb-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-display text-xl font-bold text-gray-900">
            Create Post
          </h2>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 hover:text-gray-700 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Author + audience */}
        <div className="px-5 pt-4 flex items-center gap-3">
          <Avatar
            name={session?.user?.name || ""}
            image={session?.user?.image}
            size="md"
          />
          <div>
            <p className="text-sm font-semibold text-gray-900">{session?.user?.name}</p>
            <button
              onClick={() => setShowAudiencePicker(true)}
              className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-court-green transition-colors mt-0.5 bg-gray-100 hover:bg-gray-200 px-2 py-0.5 rounded-md"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {selectedGroupIds.size === 0 ? (
                  <>
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
                  </>
                ) : (
                  <>
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                  </>
                )}
              </svg>
              {audienceLabel}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <polyline points="6,9 12,15 18,9" />
              </svg>
            </button>
          </div>
        </div>

        {/* Textarea */}
        <div className="px-5 py-3">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => {
              if (e.target.value.length <= 280) setContent(e.target.value);
              const el = e.target;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
            }}
            maxLength={280}
            placeholder={placeholder}
            className="w-full resize-none border-0 text-gray-700 text-base placeholder:text-gray-400 focus:outline-none focus:ring-0 overflow-y-auto"
            rows={2}
          />

          {/* Group tags */}
          {selectedGroupIds.size > 0 && (
            <div className="flex items-center gap-2 flex-wrap pb-2">
              {groups
                .filter((g) => selectedGroupIds.has(g.id))
                .map((g) => (
                  <span
                    key={g.id}
                    className="inline-flex items-center gap-1 text-xs font-medium text-court-green bg-court-green-soft/10 px-2.5 py-1 rounded-full"
                  >
                    {g.name}
                    <button
                      onClick={() => toggleGroup(g.id)}
                      className="ml-0.5 hover:text-red-500 transition-colors"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </span>
                ))}
            </div>
          )}

          {/* Photo grid preview (multi) */}
          {photoUrls.length > 0 && (
            <div className="mb-3">
              <div className={`grid gap-1 ${
                photoUrls.length === 1 ? "grid-cols-1" :
                photoUrls.length === 2 ? "grid-cols-2" :
                photoUrls.length <= 4 ? "grid-cols-2" :
                "grid-cols-3"
              }`}>
                {photoUrls.map((url, i) => (
                  <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
                    <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                    <button
                      onClick={() => removePhotoAt(i)}
                      className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition-colors"
                      aria-label={`Remove photo ${i + 1}`}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">
                {photoUrls.length} of {MAX_PHOTOS} photos
              </p>
            </div>
          )}

          {/* Video preview (single) */}
          {mediaUrl && mediaType === "video" && (
            <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-50 mb-3">
              <video src={`${mediaUrl}#t=0.1`} className="max-h-72 w-full object-cover" controls preload="metadata" playsInline />
              <button
                onClick={removeVideo}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition-colors"
                aria-label="Remove video"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}

          {uploading && (
            <div className="flex items-center gap-2 text-sm text-court-green-soft pb-3">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              Uploading...
            </div>
          )}

          {uploadError && <p className="text-xs text-red-500 pb-2">{uploadError}</p>}

          {/* Find Players form */}
          {findPlayers && (
            <div className="bg-gradient-to-br from-court-green/5 to-ball-yellow/10 border border-court-green-pale/30 rounded-xl p-4 mb-3 overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-court-green flex items-center gap-1.5">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                  Find Players
                </h4>
                <button
                  onClick={() => setFindPlayers(false)}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                >
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-full">
                <div className="min-w-0">
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Date</label>
                  <input
                    type="date"
                    value={playDate}
                    onChange={(e) => setPlayDate(e.target.value)}
                    className="w-full min-w-0 max-w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white box-border"
                  />
                </div>
                <div className="min-w-0">
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Time</label>
                  <input
                    type="time"
                    lang="en-GB"
                    value={playTime}
                    onChange={(e) => setPlayTime(e.target.value)}
                    className="w-full min-w-0 max-w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white box-border"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Duration</label>
                  <select
                    value={playDuration}
                    onChange={(e) => setPlayDuration(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white appearance-none"
                  >
                    {[60, 75, 90, 120].map((m) => (
                      <option key={m} value={m}>{m} min</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Level Required</label>
                  <select
                    value={skillBucket}
                    onChange={(e) => setSkillBucket(e.target.value as typeof skillBucket)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white appearance-none"
                  >
                    <option value="any">Any</option>
                    <option value="beginner">NTRP 2.5–3.0</option>
                    <option value="intermediate">NTRP 3.0–4.0</option>
                    <option value="advanced">NTRP 4.0–5.0</option>
                    <option value="pro">NTRP 5.0+</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Court Location</label>
                  <input
                    type="text"
                    value={courtLocation}
                    onChange={(e) => setCourtLocation(e.target.value)}
                    placeholder="e.g. Central Park Tennis Center"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Game Type</label>
                  <select
                    value={gameType}
                    onChange={(e) => setGameType(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white appearance-none"
                  >
                    <option value="singles">Singles</option>
                    <option value="doubles">Doubles</option>
                    <option value="mixed doubles">Mixed Doubles</option>
                    <option value="practice">Practice / Rally</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Players Needed</label>
                  <select
                    value={playersNeeded}
                    onChange={(e) => setPlayersNeeded(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white appearance-none"
                  >
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>{n} {n === 1 ? "player" : "players"}</option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-3 mt-3 pt-3 border-t border-court-green-pale/20 cursor-pointer">
                <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                  courtBooked ? "bg-court-green border-court-green" : "border-gray-300 bg-white"
                }`}>
                  {courtBooked && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
                      <polyline points="20,6 9,17 4,12" />
                    </svg>
                  )}
                </div>
                <input
                  type="checkbox"
                  checked={courtBooked}
                  onChange={(e) => setCourtBooked(e.target.checked)}
                  className="sr-only"
                />
                <span className="text-sm font-medium text-gray-700">Court booked</span>
              </label>
            </div>
          )}

          {/* Propose Team form */}
          {proposeTeam && (
            <div className="bg-gradient-to-br from-clay/5 to-clay-light/10 border border-clay/30 rounded-xl p-4 mb-3">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-clay flex items-center gap-1.5">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 9H4.5a2.5 2.5 0 010-5H6" />
                    <path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
                    <path d="M4 22h16" />
                    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
                    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
                    <path d="M18 2H6v7a6 6 0 0012 0V2z" />
                  </svg>
                  Propose a Team
                </h4>
                <button onClick={() => setProposeTeam(false)} className="text-xs text-gray-400 hover:text-red-500 transition-colors">Remove</button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Team Name</label>
                  <input
                    type="text"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    placeholder="e.g. Sunday Doubles Crew"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Team Purpose / Description</label>
                  <textarea
                    ref={teamPurposeRef}
                    value={teamPurpose}
                    onChange={(e) => setTeamPurpose(e.target.value)}
                    placeholder="What's this team about? (e.g. weekly doubles practice, tournament prep, beginners welcome...)"
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white resize-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Members Needed</label>
                  <select
                    value={teamSize}
                    onChange={(e) => setTeamSize(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white appearance-none"
                  >
                    {[2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 20].map((n) => (
                      <option key={n} value={n}>{n} members</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Team Type</label>
                  <select
                    value={teamType}
                    onChange={(e) => setTeamType(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white appearance-none"
                  >
                    <option value="casual">Casual Practice</option>
                    <option value="league">Competitive League</option>
                    <option value="tournament">Tournament Prep</option>
                    <option value="social">Social / Fun</option>
                    <option value="drilling">Drilling / Training</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Skill Level</label>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="inline-flex bg-gray-100 rounded-lg p-0.5">
                      <button
                        type="button"
                        onClick={() => { setSkillSystem("NTRP"); setSkillMin("3.0"); setSkillMax("4.0"); }}
                        className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${skillSystem === "NTRP" ? "bg-white text-court-green shadow-sm" : "text-gray-500"}`}
                      >
                        NTRP
                      </button>
                      <button
                        type="button"
                        onClick={() => { setSkillSystem("UTR"); setSkillMin("5"); setSkillMax("8"); }}
                        className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${skillSystem === "UTR" ? "bg-white text-court-green shadow-sm" : "text-gray-500"}`}
                      >
                        UTR
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {skillSystem === "NTRP" ? (
                      <>
                        <select value={skillMin} onChange={(e) => setSkillMin(e.target.value)} className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white appearance-none">
                          {["2.0", "2.5", "3.0", "3.5", "4.0", "4.5", "5.0", "5.5"].map((v) => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                        <span className="text-xs text-gray-400">to</span>
                        <select value={skillMax} onChange={(e) => setSkillMax(e.target.value)} className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white appearance-none">
                          {["2.5", "3.0", "3.5", "4.0", "4.5", "5.0", "5.5", "6.0+"].map((v) => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <>
                        <input type="number" value={skillMin} onChange={(e) => setSkillMin(e.target.value)} min="1" max="16" step="0.5" className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" placeholder="Min" />
                        <span className="text-xs text-gray-400">to</span>
                        <input type="number" value={skillMax} onChange={(e) => setSkillMax(e.target.value)} min="1" max="16" step="0.5" className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" placeholder="Max" />
                      </>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Schedule</label>
                  <input
                    type="text"
                    value={teamSchedule}
                    onChange={(e) => setTeamSchedule(e.target.value)}
                    placeholder="e.g. Weekends, Tuesdays 6-8pm, Twice a month"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Add to post bar */}
        <div className="mx-5 mb-3 flex items-center justify-between border border-gray-200 rounded-xl px-4 py-2.5">
          <span className="text-sm font-medium text-gray-700">Add to your post</span>
          <div className="flex items-center gap-1">
            <label className="p-2 rounded-lg text-green-600 hover:bg-green-50 transition-colors cursor-pointer" title="Photo">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21,15 16,10 5,21" />
              </svg>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                multiple
                onChange={handlePhotoSelect}
                disabled={uploading || photoUrls.length >= MAX_PHOTOS}
                className="hidden"
              />
            </label>
            <label className="p-2 rounded-lg text-red-500 hover:bg-red-50 transition-colors cursor-pointer" title="Video">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23,7 16,12 23,17" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime,video/mov"
                onChange={handleVideoSelect}
                disabled={uploading || photoUrls.length > 0}
                className="hidden"
              />
            </label>
            <EmojiPicker open={emojiOpen} onOpenChange={setEmojiOpen} onSelect={insertEmoji} />
            {!proposeTeam && (
              <button
                onClick={() => setFindPlayers(!findPlayers)}
                className={`p-2 rounded-lg transition-colors ${
                  findPlayers
                    ? "text-ball-yellow bg-court-green"
                    : "text-orange-500 hover:bg-orange-50"
                }`}
                title="Find Players"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
              </button>
            )}
            {groups.length > 0 && (
              <button
                onClick={() => setShowAudiencePicker(true)}
                className={`p-2 rounded-lg transition-colors ${
                  selectedGroupIds.size > 0
                    ? "text-court-green bg-court-green-soft/10"
                    : "text-blue-500 hover:bg-blue-50"
                }`}
                title="Choose audience"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Post button */}
        <div className="px-5 pb-5">
          {postError && (
            <div className="mb-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {postError}
            </div>
          )}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || posting || uploading}
            className="btn-primary w-full py-3 text-base"
          >
            {posting ? (
              <svg className="animate-spin w-5 h-5 mx-auto" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            ) : (
              "Post"
            )}
          </button>
        </div>
      </div>

      {/* Audience picker sub-modal */}
      {showAudiencePicker && (
        <div
          className="fixed inset-0 z-[1000] bg-black/40 flex items-center justify-center p-4"
          onClick={(e) => { e.stopPropagation(); setShowAudiencePicker(false); }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-gray-800">Post to</h3>
              <button
                onClick={() => setShowAudiencePicker(false)}
                className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto">
              <label className={`flex items-center gap-3 px-5 py-4 cursor-pointer transition-colors border-b border-gray-50 ${(selectedGroupIds.size === 0 && selectedFriendGroupIds.size === 0) ? "bg-court-green-soft/8" : "hover:bg-gray-50"}`}>
                <input type="radio" checked={selectedGroupIds.size === 0 && selectedFriendGroupIds.size === 0} onChange={selectAllFriends} className="sr-only" />
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${(selectedGroupIds.size === 0 && selectedFriendGroupIds.size === 0) ? "border-court-green bg-court-green" : "border-gray-300"}`}>
                  {(selectedGroupIds.size === 0 && selectedFriendGroupIds.size === 0) && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
                <div className="w-9 h-9 rounded-xl bg-court-green-pale/30 flex items-center justify-center shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-court-green-soft">
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" strokeLinecap="round" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800">All Friends</p>
                  <p className="text-xs text-gray-400">Visible to all your friends</p>
                </div>
              </label>

              {friendGroups.length > 0 && (
                <div className="px-5 pt-3 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  Friend Groups
                </div>
              )}
              {friendGroups.map((group) => (
                <label key={group.id} className={`flex items-center gap-3 px-5 py-3.5 cursor-pointer transition-colors ${selectedFriendGroupIds.has(group.id) ? "bg-court-green-soft/8" : "hover:bg-gray-50"}`}>
                  <input type="checkbox" checked={selectedFriendGroupIds.has(group.id)} onChange={() => toggleFriendGroup(group.id)} className="sr-only" />
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${selectedFriendGroupIds.has(group.id) ? "bg-court-green border-court-green" : "border-gray-300"}`}>
                    {selectedFriendGroupIds.has(group.id) && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><polyline points="20,6 9,17 4,12" /></svg>
                    )}
                  </div>
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-ball-yellow to-court-green-light flex items-center justify-center text-court-green font-bold text-xs shrink-0">
                    {group.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{group.name}</p>
                    <p className="text-xs text-gray-400">{group._count.members} {group._count.members === 1 ? "member" : "members"}</p>
                  </div>
                </label>
              ))}

              {groups.length > 0 && (
                <div className="px-5 pt-3 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  Teams
                </div>
              )}
              {groups.map((group) => (
                <label key={group.id} className={`flex items-center gap-3 px-5 py-3.5 cursor-pointer transition-colors ${selectedGroupIds.has(group.id) ? "bg-court-green-soft/8" : "hover:bg-gray-50"}`}>
                  <input type="checkbox" checked={selectedGroupIds.has(group.id)} onChange={() => toggleGroup(group.id)} className="sr-only" />
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${selectedGroupIds.has(group.id) ? "bg-court-green border-court-green" : "border-gray-300"}`}>
                    {selectedGroupIds.has(group.id) && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><polyline points="20,6 9,17 4,12" /></svg>
                    )}
                  </div>
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-court-green to-court-green-soft flex items-center justify-center text-white font-bold text-xs shrink-0">
                    {group.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{group.name}</p>
                    <p className="text-xs text-gray-400">{group._count.members} members</p>
                  </div>
                </label>
              ))}
            </div>

            <div className="p-4 border-t border-gray-100">
              <button onClick={() => setShowAudiencePicker(false)} className="btn-primary w-full py-2.5">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
