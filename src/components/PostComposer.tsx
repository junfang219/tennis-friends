"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useSession } from "next-auth/react";
import Avatar from "./Avatar";

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
}: {
  onPost: (post: Record<string, unknown>) => void;
}) {
  const { data: session } = useSession();
  const [showModal, setShowModal] = useState(false);
  const [openWithFindPlayers, setOpenWithFindPlayers] = useState(false);
  const [placeholder] = useState(
    () => PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)]
  );

  const openModal = (findPlayers = false) => {
    setOpenWithFindPlayers(findPlayers);
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
            className="flex-1 text-left px-4 py-2.5 bg-surface/60 hover:bg-surface rounded-xl text-sm text-gray-400 transition-colors"
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

        {/* Find Players CTA */}
        <button
          onClick={() => openModal(true)}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-court-green to-court-green-light text-white font-semibold text-sm hover:from-court-green-light hover:to-court-green-soft transition-all"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          Find Players for a Game
        </button>
      </div>

      {/* Full-screen modal composer — rendered via portal to escape all parent containers */}
      {showModal && createPortal(
        <ComposerModal
          session={session}
          placeholder={placeholder}
          initialFindPlayers={openWithFindPlayers}
          onPost={(post) => {
            onPost(post);
            setShowModal(false);
          }}
          onClose={() => { setShowModal(false); setOpenWithFindPlayers(false); }}
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
  onPost,
  onClose,
}: {
  session: ReturnType<typeof useSession>["data"];
  placeholder: string;
  initialFindPlayers?: boolean;
  onPost: (post: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [content, setContent] = useState("");
  const [posting, setPosting] = useState(false);
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaType, setMediaType] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Audience
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [showAudiencePicker, setShowAudiencePicker] = useState(false);

  // Find Players
  const [findPlayers, setFindPlayers] = useState(initialFindPlayers || false);
  const [playDate, setPlayDate] = useState("");
  const [playTime, setPlayTime] = useState("");
  const [courtLocation, setCourtLocation] = useState("");
  const [gameType, setGameType] = useState("singles");
  const [playersNeeded, setPlayersNeeded] = useState(1);
  const [courtBooked, setCourtBooked] = useState(false);

  useEffect(() => {
    fetch("/api/groups")
      .then((r) => r.json())
      .then((data) => setGroups(Array.isArray(data) ? data : []));
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

  const audienceLabel = selectedGroupIds.size === 0
    ? "All Friends"
    : groups.filter((g) => selectedGroupIds.has(g.id)).map((g) => g.name).join(", ");

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json();
        setUploadError(data.error || "Upload failed");
        setUploading(false);
        return;
      }
      const data = await res.json();
      setMediaUrl(data.url);
      setMediaType(data.mediaType);
    } catch {
      setUploadError("Upload failed. Please try again.");
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeMedia = () => {
    setMediaUrl("");
    setMediaType("");
    setUploadError("");
  };

  const canSubmit = findPlayers
    ? (playDate && playTime && courtLocation)
    : (content.trim() || mediaUrl);

  const handleSubmit = async () => {
    if (!canSubmit || posting || uploading) return;
    setPosting(true);

    const body: Record<string, unknown> = {
      content,
      mediaUrl,
      mediaType,
      groupIds: selectedGroupIds.size > 0 ? Array.from(selectedGroupIds) : undefined,
    };

    if (findPlayers) {
      body.postType = "find_players";
      body.playDate = playDate;
      body.playTime = playTime;
      body.courtLocation = courtLocation;
      body.gameType = gameType;
      body.playersNeeded = playersNeeded;
      body.courtBooked = courtBooked;
      if (!content.trim()) {
        body.content = `Looking for ${playersNeeded} ${playersNeeded === 1 ? "player" : "players"} for ${gameType} at ${courtLocation} on ${playDate} at ${playTime}`;
      }
    }

    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const post = await res.json();
      onPost(post);
    }
    setPosting(false);
  };

  return (
    <div
      className="fixed inset-0 z-[999] bg-black/50 flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-lg sm:rounded-2xl shadow-2xl animate-fade-in-up min-h-screen sm:min-h-0 sm:my-8 flex flex-col"
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
        <div className="flex-1 px-5 py-3">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={placeholder}
            className="w-full resize-none border-0 text-gray-700 text-base placeholder:text-gray-400 focus:outline-none focus:ring-0 min-h-[120px]"
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

          {/* Media preview */}
          {mediaUrl && (
            <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-50 mb-3">
              {mediaType === "image" ? (
                <img src={mediaUrl} alt="Attachment" className="max-h-72 w-full object-cover" />
              ) : (
                <video src={mediaUrl} className="max-h-72 w-full object-cover" controls preload="metadata" />
              )}
              <button
                onClick={removeMedia}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition-colors"
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
            <div className="bg-gradient-to-br from-court-green/5 to-ball-yellow/10 border border-court-green-pale/30 rounded-xl p-4 mb-3">
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Date</label>
                  <input
                    type="date"
                    value={playDate}
                    onChange={(e) => setPlayDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Time</label>
                  <input
                    type="time"
                    value={playTime}
                    onChange={(e) => setPlayTime(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                  />
                </div>
                <div className="col-span-2">
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
                onChange={handleFileSelect}
                disabled={uploading}
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
                onChange={handleFileSelect}
                disabled={uploading}
                className="hidden"
              />
            </label>
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
              <label className={`flex items-center gap-3 px-5 py-4 cursor-pointer transition-colors border-b border-gray-50 ${selectedGroupIds.size === 0 ? "bg-court-green-soft/8" : "hover:bg-gray-50"}`}>
                <input type="radio" checked={selectedGroupIds.size === 0} onChange={() => setSelectedGroupIds(new Set())} className="sr-only" />
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${selectedGroupIds.size === 0 ? "border-court-green bg-court-green" : "border-gray-300"}`}>
                  {selectedGroupIds.size === 0 && <div className="w-2 h-2 rounded-full bg-white" />}
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
