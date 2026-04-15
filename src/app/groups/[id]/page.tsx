"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import PostCard from "@/components/PostCard";
import EmojiPicker from "@/components/EmojiPicker";

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
              <MembersButton
                groupId={group.id}
                ownerId={group.ownerId}
                members={group.members}
                currentUserId={session?.user?.id || ""}
                onUpdate={(updated) => setGroup({ ...group, members: updated, _count: { members: updated.length } })}
              />
            </div>

            {/* Team actions */}
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Link
                href={`/groups/${group.id}/chat`}
                className="btn-primary flex items-center justify-center gap-1.5"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                </svg>
                Chat
              </Link>
              <Link
                href={`/groups/${group.id}/availability`}
                className="btn-secondary flex items-center justify-center gap-1.5"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                Availability
              </Link>
              <Link
                href={`/groups/${group.id}/practice`}
                className="btn-secondary flex items-center justify-center gap-1.5"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                Practice
              </Link>
              <Link
                href={`/groups/${group.id}/calendar`}
                className="btn-secondary flex items-center justify-center gap-1.5"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                  <line x1="8" y1="14" x2="10" y2="14" />
                  <line x1="14" y1="14" x2="16" y2="14" />
                  <line x1="8" y1="18" x2="10" y2="18" />
                  <line x1="14" y1="18" x2="16" y2="18" />
                </svg>
                Calendar
              </Link>
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">
              Team Chat also appears in your Friends → Chats inbox
            </p>
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

type FriendOption = { user: { id: string; name: string; profileImageUrl: string } };

function MembersButton({
  groupId,
  ownerId,
  members,
  currentUserId,
  onUpdate,
}: {
  groupId: string;
  ownerId: string;
  members: Member[];
  currentUserId: string;
  onUpdate: (members: Member[]) => void;
}) {
  const [show, setShow] = useState(false);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [friends, setFriends] = useState<FriendOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const isOwner = currentUserId === ownerId;
  const memberIds = new Set(members.map((m) => m.user.id));

  const openModal = () => {
    setShow(true);
    setMode("view");
    setSelected(new Set());
    setRemoved(new Set());
    setSearch("");
    setErrorMsg("");
  };

  const startEdit = async () => {
    setMode("edit");
    setErrorMsg("");
    if (friends.length === 0) {
      const res = await fetch("/api/friends");
      if (res.ok) {
        const data = await res.json();
        setFriends(data.friends || []);
      }
    }
  };

  const toggleAdd = (userId: string) => {
    if (memberIds.has(userId)) return; // already in team — handled by remove side
    const next = new Set(selected);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    setSelected(next);
  };

  const toggleRemove = (userId: string) => {
    if (userId === ownerId) return; // can't remove owner
    const next = new Set(removed);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    setRemoved(next);
  };

  const saveChanges = async () => {
    setSaving(true);
    setErrorMsg("");
    const body: Record<string, unknown> = { groupId };
    if (selected.size > 0) body.addMemberIds = Array.from(selected);
    if (isOwner && removed.size > 0) body.removeMemberIds = Array.from(removed);

    const res = await fetch("/api/groups", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const updated = await res.json();
      onUpdate(updated.members);
      setMode("view");
      setSelected(new Set());
      setRemoved(new Set());
    } else {
      const data = await res.json().catch(() => ({}));
      setErrorMsg(data.error || "Failed to save changes");
    }
    setSaving(false);
  };

  const leaveTeam = async () => {
    if (!confirm("Leave this team? You'll lose access to the team chat and feed.")) return;
    const res = await fetch("/api/inbox/state", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "team", id: groupId, action: "leave" }),
    });
    if (res.ok) {
      window.location.href = "/groups";
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to leave team");
    }
  };

  // Friends not yet in the team — for non-owners these are the only ones they can add
  const addableFriends = friends.filter(
    (f) =>
      !memberIds.has(f.user.id) &&
      f.user.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  const hasChanges = selected.size > 0 || (isOwner && removed.size > 0);

  return (
    <>
      <button
        onClick={openModal}
        className="text-xs font-medium text-court-green-soft hover:text-court-green transition-colors"
      >
        Manage
      </button>

      {show && createPortal(
        <div
          className="fixed inset-0 z-[999] bg-black/40 flex items-center justify-center p-4"
          onClick={() => setShow(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in-up max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-100 flex items-center justify-between shrink-0">
              <h3 className="font-display text-lg font-bold text-gray-800">
                {mode === "view" ? `Members (${members.length})` : isOwner ? "Edit Members" : "Add Members"}
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

            {mode === "view" ? (
              <>
                <div className="flex-1 overflow-y-auto">
                  {members.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <Link href={`/profile/${m.user.id}`} onClick={() => setShow(false)}>
                        <Avatar name={m.user.name} image={m.user.profileImageUrl} size="md" />
                      </Link>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={`/profile/${m.user.id}`}
                            onClick={() => setShow(false)}
                            className="text-sm font-semibold text-gray-800 truncate"
                          >
                            {m.user.name}
                          </Link>
                          {m.user.id === ownerId && (
                            <span className="text-[9px] font-bold tracking-wider text-court-green bg-court-green-pale/40 px-1.5 py-0.5 rounded uppercase">
                              Creator
                            </span>
                          )}
                          {m.user.id === currentUserId && (
                            <span className="text-[9px] font-medium text-gray-400">(you)</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400">{SKILL_LABELS[m.user.skillLevel] || m.user.skillLevel}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-4 border-t border-gray-100 flex gap-2 shrink-0">
                  <button onClick={startEdit} className="btn-primary flex-1">
                    {isOwner ? "Edit Members" : "Add Friends"}
                  </button>
                  {!isOwner && (
                    <button onClick={leaveTeam} className="btn-danger">
                      Leave
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="p-4 border-b border-gray-100 shrink-0">
                  <div className="relative">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                      <circle cx="11" cy="11" r="8" />
                      <path d="M21 21l-4.35-4.35" />
                    </svg>
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search friends..."
                      className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-court-green"
                    />
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2">
                    {isOwner
                      ? "As the creator, you can add new members or remove existing ones."
                      : "You can add friends to the team. Only the creator can remove members."}
                  </p>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {/* Existing members section (owner-only with remove checkboxes) */}
                  {isOwner && (
                    <>
                      <div className="px-5 pt-3 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        Current members
                      </div>
                      {members
                        .filter((m) => m.user.name.toLowerCase().includes(search.trim().toLowerCase()))
                        .map((m) => {
                          const isOwnerRow = m.user.id === ownerId;
                          const willRemove = removed.has(m.user.id);
                          return (
                            <label
                              key={m.id}
                              className={`flex items-center gap-3 px-5 py-2.5 ${isOwnerRow ? "opacity-60" : "hover:bg-gray-50 cursor-pointer"}`}
                            >
                              <input
                                type="checkbox"
                                checked={!willRemove}
                                disabled={isOwnerRow}
                                onChange={() => toggleRemove(m.user.id)}
                                className="w-4 h-4 accent-court-green"
                              />
                              <Avatar name={m.user.name} image={m.user.profileImageUrl} size="sm" />
                              <span className={`text-sm font-medium flex-1 ${willRemove ? "line-through text-gray-400" : "text-gray-800"}`}>
                                {m.user.name}
                              </span>
                              {isOwnerRow && (
                                <span className="text-[9px] font-bold tracking-wider text-court-green">CREATOR</span>
                              )}
                            </label>
                          );
                        })}
                    </>
                  )}

                  {/* Friends to add */}
                  <div className="px-5 pt-3 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    Add from your friends
                  </div>
                  {addableFriends.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">
                      {friends.length === 0
                        ? "Loading friends..."
                        : "All your friends are already in this team"}
                    </p>
                  ) : (
                    addableFriends.map((f) => (
                      <label
                        key={f.user.id}
                        className="flex items-center gap-3 px-5 py-2.5 hover:bg-gray-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(f.user.id)}
                          onChange={() => toggleAdd(f.user.id)}
                          className="w-4 h-4 accent-court-green"
                        />
                        <Avatar name={f.user.name} image={f.user.profileImageUrl} size="sm" />
                        <span className="text-sm font-medium text-gray-800">{f.user.name}</span>
                      </label>
                    ))
                  )}
                </div>

                {errorMsg && <p className="px-4 py-2 text-xs text-red-500 shrink-0">{errorMsg}</p>}

                <div className="p-4 border-t border-gray-100 flex gap-2 shrink-0">
                  <button
                    onClick={() => {
                      setMode("view");
                      setSelected(new Set());
                      setRemoved(new Set());
                      setErrorMsg("");
                    }}
                    className="btn-secondary flex-1"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveChanges}
                    disabled={!hasChanges || saving}
                    className="btn-primary flex-1"
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                </div>
              </>
            )}
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
  const [postError, setPostError] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaType, setMediaType] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    if (!el) {
      setContent((prev) => prev + emoji);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + emoji + el.value.slice(end);
    setContent(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  };

  // Find Players
  const [findPlayers, setFindPlayers] = useState(false);
  const [playDate, setPlayDate] = useState("");
  const [playTime, setPlayTime] = useState("");
  const [courtLocation, setCourtLocation] = useState("");
  const [gameType, setGameType] = useState("singles");
  const [playersNeeded, setPlayersNeeded] = useState(1);
  const [playDuration, setPlayDuration] = useState(90);
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
    setPostError("");

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
      body.playDuration = playDuration;
      body.courtBooked = courtBooked;
      if (!content.trim()) {
        body.content = `Looking for ${playersNeeded} ${playersNeeded === 1 ? "player" : "players"} for ${gameType} at ${courtLocation} on ${playDate} at ${playTime} (${playDuration} min)`;
      }
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
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Duration</label>
                  <select value={playDuration} onChange={(e) => setPlayDuration(Number(e.target.value))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white appearance-none">
                    {[60, 75, 90, 120].map((m) => (
                      <option key={m} value={m}>{m} min</option>
                    ))}
                  </select>
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
            <EmojiPicker open={emojiOpen} onOpenChange={setEmojiOpen} onSelect={insertEmoji} />
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
            ) : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}
