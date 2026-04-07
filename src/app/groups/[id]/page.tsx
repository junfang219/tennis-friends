"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import PostCard from "@/components/PostCard";

type Member = {
  id: string;
  user: { id: string; name: string; profileImageUrl: string; skillLevel: string };
};

type Post = {
  id: string;
  content: string;
  mediaUrl?: string;
  mediaType?: string;
  createdAt: string;
  author: { id: string; name: string; profileImageUrl: string };
  likeCount: number;
  isLiked: boolean;
  groups?: { id: string; name: string }[];
};

type GroupData = {
  id: string;
  name: string;
  ownerId: string;
  owner: { id: string; name: string; profileImageUrl: string };
  members: Member[];
  _count: { members: number };
  posts: Post[];
};

const SKILL_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  professional: "Professional",
};

export default function GroupPage() {
  const params = useParams();
  const { data: session } = useSession();
  const [group, setGroup] = useState<GroupData | null>(null);
  const [error, setError] = useState("");

  const loadGroup = () => {
    fetch(`/api/groups/${params.id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed");
        return r.json();
      })
      .then(setGroup)
      .catch(() => setError("Group not found or you're not a member."));
  };

  useEffect(() => {
    loadGroup();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </div>
        <p className="text-gray-500">{error}</p>
        <Link href="/friends" className="btn-primary mt-4 inline-block">
          Back to Friends
        </Link>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-white rounded-3xl p-8 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="skeleton w-16 h-16 rounded-xl" />
            <div className="space-y-2 flex-1">
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
      {/* Group header */}
      <div className="animate-fade-in-up">
        <div className="bg-white rounded-3xl shadow-sm border border-court-green-pale/20 overflow-hidden">
          {/* Banner */}
          <div className="h-28 bg-gradient-to-br from-court-green via-court-green-light to-court-green-soft court-pattern relative">
            <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" />
          </div>

          <div className="px-6 -mt-8 relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-court-green to-court-green-soft flex items-center justify-center text-white font-bold text-2xl shadow-xl ring-4 ring-white">
              {group.name.charAt(0).toUpperCase()}
            </div>
          </div>

          <div className="px-6 pb-6 pt-3">
            <h1 className="font-display text-2xl font-bold text-gray-900">
              {group.name}
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              {group._count.members} {group._count.members === 1 ? "member" : "members"} · Created by {group.owner.name}
            </p>

            {/* Members row */}
            <div className="mt-4 flex items-center gap-3">
              <div className="flex items-center -space-x-2">
                {group.members.slice(0, 6).map((m) => (
                  <Link key={m.id} href={`/profile/${m.user.id}`} title={m.user.name}>
                    <Avatar name={m.user.name} image={m.user.profileImageUrl} size="sm" />
                  </Link>
                ))}
                {group.members.length > 6 && (
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-semibold text-gray-500 ring-2 ring-white">
                    +{group.members.length - 6}
                  </div>
                )}
              </div>
              <MembersButton members={group.members} />
            </div>

            {/* Group Chat button */}
            <div className="mt-4">
              <Link
                href={`/groups/${group.id}/chat`}
                className="btn-primary inline-flex"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                </svg>
                Group Chat
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Post composer for group */}
      <div className="mt-6 animate-fade-in-up stagger-1">
        <GroupPostComposer
          groupId={group.id}
          groupName={group.name}
          session={session}
          onPost={(post) => setGroup({ ...group, posts: [post as Post, ...group.posts] })}
        />
      </div>

      {/* Posts feed */}
      <div className="mt-5 space-y-4">
        {group.posts.length === 0 ? (
          <div className="animate-fade-in-up stagger-2 text-center py-16 bg-white rounded-2xl shadow-sm border border-court-green-pale/20">
            <div className="w-14 h-14 bg-ball-yellow/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <div className="w-7 h-7 rounded-full bg-ball-yellow animate-ball-bounce" />
            </div>
            <h3 className="font-display text-lg font-bold text-gray-800 mb-2">
              No posts in this group yet
            </h3>
            <p className="text-gray-500 text-sm">Be the first to share something with the group!</p>
          </div>
        ) : (
          group.posts.map((post, i) => (
            <div key={post.id} className={`animate-fade-in-up stagger-${Math.min(i + 2, 5)}`}>
              <PostCard post={post} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ────── Members button + modal ────── */

function MembersButton({ members }: { members: Member[] }) {
  const [show, setShow] = useState(false);

  return (
    <>
      <button
        onClick={() => setShow(true)}
        className="text-xs font-medium text-court-green-soft hover:text-court-green transition-colors"
      >
        View all
      </button>

      {show && createPortal(
        <div
          className="fixed inset-0 z-[999] bg-black/40 flex items-center justify-center p-4"
          onClick={() => setShow(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-gray-800">
                Members ({members.length})
              </h3>
              <button
                onClick={() => setShow(false)}
                className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {members.map((m) => (
                <Link
                  key={m.id}
                  href={`/profile/${m.user.id}`}
                  onClick={() => setShow(false)}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
                >
                  <Avatar name={m.user.name} image={m.user.profileImageUrl} size="md" />
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{m.user.name}</p>
                    <p className="text-xs text-gray-400">{SKILL_LABELS[m.user.skillLevel] || m.user.skillLevel}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

/* ────── Group Post Composer (posts directly to the group) ────── */

function GroupPostComposer({
  groupId,
  groupName,
  session,
  onPost,
}: {
  groupId: string;
  groupName: string;
  session: ReturnType<typeof useSession>["data"];
  onPost: (post: Record<string, unknown>) => void;
}) {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      {/* Trigger */}
      <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-4">
        <div className="flex items-center gap-3">
          <Avatar name={session?.user?.name || ""} image={session?.user?.image} size="md" />
          <button
            onClick={() => setShowModal(true)}
            className="flex-1 text-left px-4 py-2.5 bg-surface/60 hover:bg-surface rounded-xl text-sm text-gray-400 transition-colors"
          >
            Write something to {groupName}...
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="p-2 rounded-lg text-gray-400 hover:text-court-green-soft hover:bg-court-green-soft/8 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21,15 16,10 5,21" />
            </svg>
          </button>
        </div>
      </div>

      {/* Modal */}
      {showModal && createPortal(
        <GroupComposerModal
          groupId={groupId}
          groupName={groupName}
          session={session}
          onPost={(post) => { onPost(post); setShowModal(false); }}
          onClose={() => setShowModal(false)}
        />,
        document.body
      )}
    </>
  );
}

function GroupComposerModal({
  groupId,
  groupName,
  session,
  onPost,
  onClose,
}: {
  groupId: string;
  groupName: string;
  session: ReturnType<typeof useSession>["data"];
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

  // Find Players
  const [findPlayers, setFindPlayers] = useState(false);
  const [playDate, setPlayDate] = useState("");
  const [playTime, setPlayTime] = useState("");
  const [courtLocation, setCourtLocation] = useState("");
  const [gameType, setGameType] = useState("singles");
  const [playersNeeded, setPlayersNeeded] = useState(1);
  const [courtBooked, setCourtBooked] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    setTimeout(() => textareaRef.current?.focus(), 100);
    return () => { document.body.style.overflow = ""; };
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) { const d = await res.json(); setUploadError(d.error || "Upload failed"); setUploading(false); return; }
      const data = await res.json();
      setMediaUrl(data.url);
      setMediaType(data.mediaType);
    } catch { setUploadError("Upload failed."); }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
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
      groupIds: [groupId],
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
            Post to Group
          </h2>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 hover:text-gray-700 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Author + group badge */}
        <div className="px-5 pt-4 flex items-center gap-3">
          <Avatar name={session?.user?.name || ""} image={session?.user?.image} size="md" />
          <div>
            <p className="text-sm font-semibold text-gray-900">{session?.user?.name}</p>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-court-green bg-court-green-soft/10 px-2 py-0.5 rounded-md mt-0.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
              </svg>
              {groupName}
            </span>
          </div>
        </div>

        {/* Textarea */}
        <div className="flex-1 px-5 py-3">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={findPlayers ? "Add a note (optional)..." : `Write something to ${groupName}...`}
            className="w-full resize-none border-0 text-gray-700 text-base placeholder:text-gray-400 focus:outline-none focus:ring-0 min-h-[120px]"
          />

          {mediaUrl && (
            <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-50 mb-3">
              {mediaType === "image" ? (
                <img src={mediaUrl} alt="Attachment" className="max-h-72 w-full object-cover" />
              ) : (
                <video src={mediaUrl} className="max-h-72 w-full object-cover" controls preload="metadata" />
              )}
              <button onClick={() => { setMediaUrl(""); setMediaType(""); }} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
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
                <button onClick={() => setFindPlayers(false)} className="text-xs text-gray-400 hover:text-red-500 transition-colors">
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Date</label>
                  <input type="date" value={playDate} onChange={(e) => setPlayDate(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Time</label>
                  <input type="time" value={playTime} onChange={(e) => setPlayTime(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Court Location</label>
                  <input type="text" value={courtLocation} onChange={(e) => setCourtLocation(e.target.value)} placeholder="e.g. Central Park Tennis Center" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Game Type</label>
                  <select value={gameType} onChange={(e) => setGameType(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white appearance-none">
                    <option value="singles">Singles</option>
                    <option value="doubles">Doubles</option>
                    <option value="mixed doubles">Mixed Doubles</option>
                    <option value="practice">Practice / Rally</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Players Needed</label>
                  <select value={playersNeeded} onChange={(e) => setPlayersNeeded(Number(e.target.value))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white appearance-none">
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>{n} {n === 1 ? "player" : "players"}</option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-3 mt-3 pt-3 border-t border-court-green-pale/20 cursor-pointer">
                <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${courtBooked ? "bg-court-green border-court-green" : "border-gray-300 bg-white"}`}>
                  {courtBooked && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><polyline points="20,6 9,17 4,12" /></svg>
                  )}
                </div>
                <input type="checkbox" checked={courtBooked} onChange={(e) => setCourtBooked(e.target.checked)} className="sr-only" />
                <span className="text-sm font-medium text-gray-700">Court booked</span>
              </label>
            </div>
          )}
        </div>

        {/* Add to post */}
        <div className="mx-5 mb-3 flex items-center justify-between border border-gray-200 rounded-xl px-4 py-2.5">
          <span className="text-sm font-medium text-gray-700">Add to your post</span>
          <div className="flex items-center gap-1">
            <label className="p-2 rounded-lg text-green-600 hover:bg-green-50 transition-colors cursor-pointer" title="Photo">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21,15 16,10 5,21" />
              </svg>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={handleFileSelect} disabled={uploading} className="hidden" />
            </label>
            <label className="p-2 rounded-lg text-red-500 hover:bg-red-50 transition-colors cursor-pointer" title="Video">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23,7 16,12 23,17" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
              <input type="file" accept="video/mp4,video/webm,video/quicktime,video/mov" onChange={handleFileSelect} disabled={uploading} className="hidden" />
            </label>
            <button
              onClick={() => setFindPlayers(!findPlayers)}
              className={`p-2 rounded-lg transition-colors ${findPlayers ? "text-ball-yellow bg-court-green" : "text-orange-500 hover:bg-orange-50"}`}
              title="Find Players"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
            </button>
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
            ) : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}
