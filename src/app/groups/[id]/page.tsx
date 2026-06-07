"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import { createPortal } from "react-dom";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import CoverEditMenu from "@/components/CoverEditMenu";
import PostCard from "@/components/PostCard";
import EmojiPicker from "@/components/EmojiPicker";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  getGroup,
  listGroupMembers,
  listGroupFeed,
  listFriends,
  createPost,
} from "@/lib/supabase/queries";
import { toGroupCamel, toGroupMemberCamel } from "@/lib/supabase/adapters";
import { adaptFeedPost, type FeedPostView } from "@/lib/adaptFeedPost";
import { uploadToBucket, isUploadError } from "@/lib/supabase/upload";
import { errorMessage } from "@/lib/errorMessage";

type Member = {
  id: string;
  user: { id: string; name: string; profileImageUrl: string; skillLevel: string };
};

type Post = FeedPostView;

type GroupData = {
  id: string;
  name: string;
  imageUrl: string;
  coverImageUrl: string;
  coverOffsetY: number;
  coverScale: number;
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

  const loadGroup = async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      const id = String(params.id);
      const [g, members, postRows] = await Promise.all([
        getGroup(supabase, id),
        listGroupMembers(supabase, id),
        listGroupFeed(supabase, id),
      ]);
      if (!g) {
        setError("Group not found or you're not a member.");
        return;
      }
      const groupCamel = toGroupCamel(g);
      const adaptedMembers = members.map((m) => ({
        id: m.id,
        user: {
          id: m.user.id,
          name: m.user.name,
          profileImageUrl: m.user.profile_image_url,
          skillLevel: "",
        },
      }));
      const next: GroupData = {
        ...groupCamel,
        // toGroupCamel doesn't expose these — set defaults until the
        // adapter covers them.
        coverOffsetY: 50,
        coverScale: 100,
        owner: { id: g.owner_id, name: "", profileImageUrl: "" },
        members: adaptedMembers,
        _count: { members: adaptedMembers.length },
        posts: postRows.map(adaptFeedPost),
      };
      setGroup(next);
      void toGroupMemberCamel;
    } catch {
      setError("Group not found or you're not a member.");
    }
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
          <TeamCoverEditor
            groupId={group.id}
            coverImageUrl={group.coverImageUrl}
            coverOffsetY={group.coverOffsetY}
            coverScale={group.coverScale}
            canEdit={session?.user?.id === group.ownerId}
            onUpdate={(patch) => setGroup({ ...group, ...patch })}
          />

          <div className="px-6 -mt-8 relative">
            <TeamAvatarEditor
              groupId={group.id}
              name={group.name}
              imageUrl={group.imageUrl}
              canEdit={session?.user?.id === group.ownerId}
              onUpdate={(imageUrl) => setGroup({ ...group, imageUrl })}
            />
          </div>

          <div className="px-6 pb-6 pt-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h1 className="font-display text-2xl font-bold text-gray-900">
                  {group.name}
                </h1>
                <p className="text-gray-500 text-sm mt-1">
                  {group._count.members} {group._count.members === 1 ? "member" : "members"} · Created by {group.owner.name}
                </p>
              </div>
              <Link
                href={`/groups/${group.id}/settings`}
                className="shrink-0 w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 flex items-center justify-center transition-colors"
                aria-label="Team settings"
                title="Team settings"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                </svg>
              </Link>
            </div>

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
              <Link
                href={`/groups/${group.id}/albums`}
                className="btn-secondary flex items-center justify-center gap-1.5"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                Albums
              </Link>
              <Link
                href={`/groups/${group.id}/files`}
                className="btn-secondary flex items-center justify-center gap-1.5"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                Files
              </Link>
              <Link
                href={`/groups/${group.id}/scouting`}
                className="btn-secondary flex items-center justify-center gap-1.5"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                Scouting
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
          onPost={(post) => setGroup({ ...group, posts: [post, ...group.posts] })}
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

/* ────── Team cover editor ────── */

function TeamCoverEditor({
  groupId,
  coverImageUrl,
  coverOffsetY,
  coverScale,
  canEdit,
  onUpdate,
}: {
  groupId: string;
  coverImageUrl: string;
  coverOffsetY: number;
  coverScale: number;
  canEdit: boolean;
  onUpdate: (patch: { coverImageUrl?: string; coverOffsetY?: number; coverScale?: number }) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [repositioning, setRepositioning] = useState(false);
  const [draftOffsetY, setDraftOffsetY] = useState(coverOffsetY);
  const [draftScale, setDraftScale] = useState(coverScale);

  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const dragStartRef = useRef<{ clientY: number; startOffsetY: number; bannerH: number } | null>(null);
  const pinchStartRef = useRef<{ distance: number; startScale: number } | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    if (!file.type.startsWith("image/")) {
      setError("Cover must be an image.");
      e.target.value = "";
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Cover must be under 10 MB.");
      e.target.value = "";
      return;
    }
    setUploading(true);
    try {
      const upResult = await uploadToBucket(file, "avatars");
      if (isUploadError(upResult)) {
        setError(upResult.message);
        setUploading(false);
        e.target.value = "";
        return;
      }
      const supabase = createSupabaseBrowserClient();
      const { error: upErr } = await supabase
        .from("groups")
        .update({
          cover_image_url: upResult.url,
          cover_offset_y: 50,
          cover_scale: 100,
        })
        .eq("id", groupId);
      if (upErr) {
        setError(upErr.message || "Could not save cover.");
      } else {
        onUpdate({ coverImageUrl: upResult.url, coverOffsetY: 50, coverScale: 100 });
        setDraftOffsetY(50);
        setDraftScale(100);
        setRepositioning(true);
      }
    } catch {
      setError("Network error.");
    }
    setUploading(false);
    e.target.value = "";
  };

  const startRepositioning = () => {
    setDraftOffsetY(coverOffsetY);
    setDraftScale(coverScale);
    setRepositioning(true);
  };

  const distanceBetween = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!repositioning) return;
    const t = e.target as HTMLElement;
    if (t.closest("button") || t.closest("input")) return;
    e.preventDefault();
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);

    if (pointersRef.current.size === 2) {
      const [a, b] = Array.from(pointersRef.current.values());
      pinchStartRef.current = { distance: distanceBetween(a, b), startScale: draftScale };
      dragStartRef.current = null;
    } else if (pointersRef.current.size === 1) {
      const rect = e.currentTarget.getBoundingClientRect();
      dragStartRef.current = { clientY: e.clientY, startOffsetY: draftOffsetY, bannerH: rect.height };
      pinchStartRef.current = null;
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!repositioning) return;
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2 && pinchStartRef.current) {
      const [a, b] = Array.from(pointersRef.current.values());
      const ratio = distanceBetween(a, b) / pinchStartRef.current.distance;
      const next = Math.max(100, Math.min(300, Math.round(pinchStartRef.current.startScale * ratio)));
      setDraftScale(next);
      return;
    }
    if (pointersRef.current.size === 1 && dragStartRef.current) {
      const { clientY, startOffsetY, bannerH } = dragStartRef.current;
      const delta = ((e.clientY - clientY) / bannerH) * 100 * 1.5;
      const next = Math.max(0, Math.min(100, startOffsetY - delta));
      setDraftOffsetY(next);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!repositioning) return;
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.delete(e.pointerId);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}

    if (pointersRef.current.size < 2) pinchStartRef.current = null;
    if (pointersRef.current.size === 1) {
      const remaining = Array.from(pointersRef.current.values())[0];
      const rect = e.currentTarget.getBoundingClientRect();
      dragStartRef.current = { clientY: remaining.y, startOffsetY: draftOffsetY, bannerH: rect.height };
    }
    if (pointersRef.current.size === 0) dragStartRef.current = null;
  };

  const saveFraming = async () => {
    const offsetY = Math.round(draftOffsetY);
    const scale = Math.round(draftScale);
    const supabase = createSupabaseBrowserClient();
    const { error: upErr } = await supabase
      .from("groups")
      .update({ cover_offset_y: offsetY, cover_scale: scale })
      .eq("id", groupId);
    if (!upErr) {
      onUpdate({ coverOffsetY: offsetY, coverScale: scale });
      setRepositioning(false);
    } else {
      setError("Could not save framing.");
    }
  };

  const cancelRepositioning = () => {
    setDraftOffsetY(coverOffsetY);
    setDraftScale(coverScale);
    setRepositioning(false);
    pointersRef.current.clear();
    dragStartRef.current = null;
    pinchStartRef.current = null;
  };

  return (
    <>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`h-28 relative overflow-hidden select-none ${repositioning ? "cursor-grabbing" : ""} ${coverImageUrl ? "" : "bg-gradient-to-br from-court-green via-court-green-light to-court-green-soft court-pattern"}`}
        style={{ touchAction: repositioning ? "none" : undefined }}
      >
        {coverImageUrl ? (
          <img
            src={coverImageUrl}
            alt=""
            draggable={false}
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            style={{
              objectPosition: `center ${repositioning ? draftOffsetY : coverOffsetY}%`,
              transform: `scale(${(repositioning ? draftScale : coverScale) / 100})`,
              transformOrigin: "center",
            }}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" />
        )}
        {coverImageUrl && !repositioning && (
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent pointer-events-none" />
        )}

        {repositioning && (
          <>
            <div className="absolute inset-0 bg-black/20 pointer-events-none flex items-center justify-center">
              <p className="text-white text-xs font-semibold bg-black/50 backdrop-blur px-3 py-1 rounded-full">
                Drag · pinch · or use the slider
              </p>
            </div>
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

        {canEdit && !repositioning && (
          <CoverEditMenu
            onChangePhoto={() => fileInputRef.current?.click()}
            onReposition={coverImageUrl ? startRepositioning : undefined}
            uploading={uploading}
          />
        )}

        {canEdit && repositioning && (
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
              onClick={saveFraming}
              className="px-3 h-9 rounded-full bg-court-green hover:bg-court-green-light text-white text-xs font-bold transition-colors"
            >
              Save
            </button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          onChange={handleFileSelect}
          disabled={uploading}
          className="hidden"
        />
      </div>
      {error && <p className="text-xs text-red-600 px-6 pt-2">{error}</p>}
    </>
  );
}

/* ────── Team avatar editor ────── */

function TeamAvatarEditor({
  groupId,
  name,
  imageUrl,
  canEdit,
  onUpdate,
}: {
  groupId: string;
  name: string;
  imageUrl: string;
  canEdit: boolean;
  onUpdate: (imageUrl: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const upResult = await uploadToBucket(file, "avatars");
      if (isUploadError(upResult)) {
        setError(upResult.message);
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
      const supabase = createSupabaseBrowserClient();
      const { error: upErr } = await supabase
        .from("groups")
        .update({ image_url: upResult.url })
        .eq("id", groupId);
      if (upErr) {
        setError(upErr.message || "Failed to update photo");
      } else {
        onUpdate(upResult.url);
      }
    } catch {
      setError("Upload failed. Please try again.");
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const inner = imageUrl ? (
    <img
      src={imageUrl}
      alt={name}
      className="w-16 h-16 rounded-2xl object-cover shadow-xl ring-4 ring-white"
    />
  ) : (
    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-court-green to-court-green-soft flex items-center justify-center text-white font-bold text-2xl shadow-xl ring-4 ring-white">
      {name.charAt(0).toUpperCase()}
    </div>
  );

  if (!canEdit) {
    return inner;
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="block group rounded-2xl focus:outline-none focus:ring-2 focus:ring-court-green-soft"
        aria-label="Change team photo"
      >
        {inner}
        <span className="absolute inset-0 rounded-2xl bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </span>
        {uploading && (
          <span className="absolute inset-0 rounded-2xl bg-black/50 flex items-center justify-center pointer-events-none">
            <svg className="animate-spin w-5 h-5 text-white" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
              <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </span>
        )}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        onChange={handleFileSelect}
        disabled={uploading}
        className="hidden"
      />
      {error && (
        <p className="absolute top-full left-0 mt-1 text-xs text-red-500 whitespace-nowrap">{error}</p>
      )}
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
      const supabase = createSupabaseBrowserClient();
      const rows = await listFriends(supabase);
      setFriends(
        rows.map((u) => ({
          friendshipId: u.id,
          user: {
            id: u.id,
            name: u.name,
            profileImageUrl: u.profile_image_url,
            skillLevel: u.skill_level,
          },
        }))
      );
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
    try {
      const supabase = createSupabaseBrowserClient();
      if (selected.size > 0) {
        const rows = Array.from(selected).map((uid) => ({
          group_id: groupId,
          user_id: uid,
          roles: [] as ("manager" | "captain")[],
        }));
        await supabase.from("group_members").insert(rows);
      }
      if (isOwner && removed.size > 0) {
        await supabase
          .from("group_members")
          .delete()
          .eq("group_id", groupId)
          .in("user_id", Array.from(removed));
      }
      // Reload members.
      const members = await listGroupMembers(supabase, groupId);
      onUpdate(
        members.map((m) => ({
          id: m.id,
          user: {
            id: m.user.id,
            name: m.user.name,
            profileImageUrl: m.user.profile_image_url,
            skillLevel: "",
          },
        }))
      );
      setMode("view");
      setSelected(new Set());
      setRemoved(new Set());
    } catch (err) {
      setErrorMsg(errorMessage(err, "Failed to save changes"));
    }
    setSaving(false);
  };

  const leaveTeam = async () => {
    if (!confirm("Leave this team? You'll lose access to the team chat and feed.")) return;
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      await supabase
        .from("group_members")
        .delete()
        .eq("group_id", groupId)
        .eq("user_id", auth.user.id);
      window.location.href = "/groups";
    } catch (err) {
      alert(errorMessage(err, "Failed to leave team"));
    }
  };

  const deleteTeam = async () => {
    if (!confirm("Delete this team? This removes the team and its chat, matches, and practices for all members. This cannot be undone.")) return;
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: delErr } = await supabase.from("groups").delete().eq("id", groupId);
      if (delErr) throw delErr;
      window.location.href = "/groups";
    } catch (err) {
      alert(errorMessage(err, "Failed to delete team"));
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
                  {isOwner ? (
                    <button onClick={deleteTeam} className="btn-danger">
                      Delete
                    </button>
                  ) : (
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
  onPost: (post: FeedPostView) => void;
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
  onPost: (post: FeedPostView) => void;
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
    const upResult = await uploadToBucket(file, "posts");
    if (isUploadError(upResult)) {
      setUploadError(upResult.message);
    } else {
      setMediaUrl(upResult.url);
      setMediaType(upResult.mediaType);
    }
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
      const supabase = createSupabaseBrowserClient();
      // This inline group composer supports a single attachment (one image
      // OR one video); the main PostComposer is the place for mixed media.
      // Either way the wire shape is the unified media[] list.
      const attachUrl = typeof body.mediaUrl === "string" ? body.mediaUrl : "";
      const attachKind: "image" | "video" =
        typeof body.mediaType === "string" && body.mediaType === "video"
          ? "video"
          : "image";
      const newPost = await createPost(supabase, {
        content: typeof body.content === "string" ? body.content : "",
        post_type: (body.postType as "regular" | "find_players") || "regular",
        play_date: typeof body.playDate === "string" ? body.playDate : "",
        play_time: typeof body.playTime === "string" ? body.playTime : "",
        play_duration: typeof body.playDuration === "number" ? body.playDuration : 90,
        court_location: typeof body.courtLocation === "string" ? body.courtLocation : "",
        game_type: typeof body.gameType === "string" ? body.gameType : "",
        players_needed: typeof body.playersNeeded === "number" ? body.playersNeeded : 0,
        court_booked: !!body.courtBooked,
        media: attachUrl ? [{ url: attachUrl, kind: attachKind }] : [],
      });
      // Cross-post to this group via the join table.
      await supabase
        .from("post_targets")
        .insert({ post_id: newPost.id, target_kind: "group", group_id: groupId });
      // createPost enriches before the target insert above, so newPost.groups
      // is empty — graft this group on so the optimistic card shows the right
      // audience badge immediately.
      const optimistic = adaptFeedPost(newPost);
      optimistic.groups = [{ id: groupId, name: groupName }];
      onPost(optimistic);
    } catch (err) {
      setPostError(errorMessage(err, "Network error"));
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
        className="bg-white w-full sm:max-w-lg sm:rounded-2xl shadow-2xl animate-fade-in-up min-h-screen sm:min-h-0 sm:my-8 flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:pt-0 sm:pb-0"
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
        <div className="px-5 py-3">
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
                <video src={`${mediaUrl}#t=0.1`} className="max-h-72 w-full object-cover" controls preload="metadata" playsInline />
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
                  <input type="time" lang="en-GB" value={playTime} onChange={(e) => setPlayTime(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
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
