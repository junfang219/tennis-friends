"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useSession } from "@/lib/supabase/nextauth-compat";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Avatar from "./Avatar";
import EmojiPicker from "./EmojiPicker";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  likePost,
  unlikePost,
  hidePost,
  deletePost,
  listComments,
  addComment,
  requestToJoin,
  cancelPlayRequest,
  listMyGroups,
  listMyFriendGroups,
  listFriends,
} from "@/lib/supabase/queries";
import { toCommentCamel } from "@/lib/supabase/adapters";

type PlayRequestInfo = { id: string; status: string; note: string } | null;

type CommentData = {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string; profileImageUrl: string };
};

type Post = {
  id: string;
  content: string;
  mediaUrl?: string;
  mediaType?: string;
  photoUrls?: string[];
  postType?: string;
  playDate?: string;
  playTime?: string;
  playDuration?: number;
  skillMin?: number | null;
  skillMax?: number | null;
  courtLocation?: string;
  gameType?: string;
  playersNeeded?: number;
  playersConfirmed?: number;
  courtBooked?: boolean;
  isComplete?: boolean;
  isBroadcast?: boolean;
  broadcastRadiusMi?: number;
  distanceMiles?: number | null;
  sessionChatId?: string | null;
  teamGroupId?: string | null;
  commentsDisabled?: boolean;
  manualPlayers?: string;
  pendingRequestCount?: number;
  myPlayRequest?: PlayRequestInfo;
  approvedPlayerNames?: string[];
  commentCount?: number;
  createdAt: string;
  author: { id: string; name: string; profileImageUrl: string };
  likeCount: number;
  isLiked: boolean;
  groups?: { id: string; name: string }[];
  friendGroups?: { id: string; name: string }[];
  event?: {
    id: string;
    title: string;
    eventType: string;
    startDate: string;
    endDate: string;
    venueName: string;
    maxParticipants: number | null;
    ntrpMin: number | null;
    ntrpMax: number | null;
    coverImageUrl: string;
    registeredCount: number;
  } | null;
};

type PlayRequest = {
  id: string;
  status: string;
  note: string;
  user: {
    id: string;
    name: string;
    profileImageUrl: string;
    skillLevel: string;
    gender?: string;
    ratingSystem?: string;
    ntrpRating?: number | null;
    utrRating?: number | null;
  };
};

const SKILL_LABELS: Record<string, string> = {
  beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced", professional: "Professional",
};

function GenderSymbol({ gender }: { gender?: string }) {
  if (gender === "male") return <span title="Male" className="text-blue-500 font-semibold">♂</span>;
  if (gender === "female") return <span title="Female" className="text-pink-500 font-semibold">♀</span>;
  if (gender === "non_binary") return <span title="Non-binary" className="text-purple-500 font-semibold">⚧</span>;
  return null;
}

function formatUserRating(u: PlayRequest["user"]): string {
  if (u.ratingSystem === "ntrp" && u.ntrpRating != null) return `NTRP ${u.ntrpRating.toFixed(1)}`;
  if (u.ratingSystem === "utr" && u.utrRating != null) return `UTR ${u.utrRating.toFixed(2)}`;
  if (u.ratingSystem === "self") return SKILL_LABELS[u.skillLevel] || u.skillLevel;
  return SKILL_LABELS[u.skillLevel] || u.skillLevel || "";
}

function timeAgo(date: string) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function PostCard({ post, onDelete, onUpdate, onOpenChat, initialExpanded = false, initialShowComments = false }: { post: Post; onDelete?: (id: string) => void; onUpdate?: (id: string, updates: Partial<Post>) => void; onOpenChat?: () => void; initialExpanded?: boolean; initialShowComments?: boolean }) {
  const { data: session } = useSession();
  const isAuthor = session?.user?.id === post.author.id;
  const isFindPlayers = post.postType === "find_players";
  const isProposeTeam = post.postType === "propose_team";
  const isRecruiting = isFindPlayers || isProposeTeam;

  const [liked, setLiked] = useState(post.isLiked);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [animating, setAnimating] = useState(false);
  // Index of the photo currently in view (carousel + lightbox).
  const [photoIndex, setPhotoIndex] = useState(0);
  const photoStripRef = useRef<HTMLDivElement>(null);
  const [deleted, setDeleted] = useState(false);

  // Unified photo list — prefer photoUrls (multi support); fall back to legacy
  // single mediaUrl when the API or older client hasn't migrated yet.
  const photos: string[] = (post.photoUrls && post.photoUrls.length > 0)
    ? post.photoUrls
    : (post.mediaType === "image" && post.mediaUrl ? [post.mediaUrl] : []);

  // Play request state
  const [myRequest, setMyRequest] = useState<PlayRequestInfo>(post.myPlayRequest || null);
  const [joining, setJoining] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const approvedCount = post.approvedPlayerNames?.length || 0;
  const manualCount = post.manualPlayers ? post.manualPlayers.split(",").filter((n) => n.trim()).length : 0;
  const [confirmed, setConfirmed] = useState(Math.max(post.playersConfirmed || 0, approvedCount + manualCount));
  const [complete, setComplete] = useState(post.isComplete || false);
  const [liveSessionChatId, setLiveSessionChatId] = useState<string | null>(post.sessionChatId || null);
  const [liveTeamGroupId, setLiveTeamGroupId] = useState<string | null>(post.teamGroupId || null);

  // Comments
  const [showComments, setShowComments] = useState(initialShowComments);
  const [comments, setComments] = useState<CommentData[]>([]);
  const [commentInput, setCommentInput] = useState("");
  const [commentCount, setCommentCount] = useState(post.commentCount || 0);
  const [postingComment, setPostingComment] = useState(false);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [commentEmojiOpen, setCommentEmojiOpen] = useState(false);
  const commentInputRef = useRef<HTMLInputElement>(null);

  const insertCommentEmoji = (emoji: string) => {
    const el = commentInputRef.current;
    if (!el) {
      setCommentInput((prev) => prev + emoji);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + emoji + el.value.slice(end);
    setCommentInput(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  };

  // Post menu
  const [showMenu, setShowMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editContent, setEditContent] = useState(post.content);
  const [currentContent, setCurrentContent] = useState(post.content);
  const [savingEdit, setSavingEdit] = useState(false);
  const [commentsOff, setCommentsOff] = useState(post.commentsDisabled || false);

  // Editable find-player fields
  const [editPlayDate, setEditPlayDate] = useState(post.playDate || "");
  const [editPlayTime, setEditPlayTime] = useState(post.playTime || "");
  const [editPlayDuration, setEditPlayDuration] = useState(post.playDuration || 90);
  const [editCourtLocation, setEditCourtLocation] = useState(post.courtLocation || "");
  const [editGameType, setEditGameType] = useState(post.gameType || "singles");
  const [editPlayersNeeded, setEditPlayersNeeded] = useState(post.playersNeeded || 1);
  const [editCourtBooked, setEditCourtBooked] = useState(post.courtBooked || false);

  // Audience editing
  const [availableTeams, setAvailableTeams] = useState<{ id: string; name: string; _count?: { members: number } }[]>([]);
  const [availableFriendGroups, setAvailableFriendGroups] = useState<{ id: string; name: string; _count?: { members: number } }[]>([]);
  const [editSelectedTeamIds, setEditSelectedTeamIds] = useState<Set<string>>(new Set((post.groups || []).map((g) => g.id)));
  const [editSelectedFriendGroupIds, setEditSelectedFriendGroupIds] = useState<Set<string>>(new Set((post.friendGroups || []).map((g) => g.id)));
  const [showEditAudiencePicker, setShowEditAudiencePicker] = useState(false);
  const [liveGroups, setLiveGroups] = useState<{ id: string; name: string }[]>(post.groups || []);
  const [liveFriendGroups, setLiveFriendGroups] = useState<{ id: string; name: string }[]>(post.friendGroups || []);

  // Live display state for find-player fields
  const [livePlayDate, setLivePlayDate] = useState(post.playDate || "");
  const [livePlayTime, setLivePlayTime] = useState(post.playTime || "");
  const [livePlayDuration, setLivePlayDuration] = useState(post.playDuration || 90);
  const [liveCourtLocation, setLiveCourtLocation] = useState(post.courtLocation || "");
  const [liveGameType, setLiveGameType] = useState(post.gameType || "");
  const [livePlayersNeeded, setLivePlayersNeeded] = useState(post.playersNeeded || 0);
  const [liveCourtBooked, setLiveCourtBooked] = useState(post.courtBooked || false);
  const [liveManualPlayers, setLiveManualPlayers] = useState(post.manualPlayers || "");

  // Send to friend
  const [showSendToFriend, setShowSendToFriend] = useState(false);

  // Collapsed state for completed recruiting posts (game posts + team requests)
  const [expanded, setExpanded] = useState(initialExpanded);
  const isCollapsible = isRecruiting && complete;

  // Derive end time from start + duration ("14:00" + 90 → "15:30")
  const endTime = (() => {
    if (!livePlayTime || !livePlayTime.includes(":")) return "";
    const [h, m] = livePlayTime.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return "";
    const total = h * 60 + m + (livePlayDuration || 0);
    const eh = Math.floor((total % (24 * 60)) / 60);
    const em = total % 60;
    return `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
  })();

  // Likes modal
  const [showLikes, setShowLikes] = useState(false);
  const [likers, setLikers] = useState<{ id: string; name: string; profileImageUrl: string; skillLevel: string }[]>([]);
  const [loadingLikers, setLoadingLikers] = useState(false);

  const openLikesModal = async () => {
    setShowLikes(true);
    setLoadingLikers(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase
        .from("likes")
        .select(
          `user:profiles!likes_user_id_fkey ( id, name, profile_image_url, skill_level )`
        )
        .eq("post_id", post.id);
      const rows = (data ?? [])
        .map((r) => (r as unknown as { user: { id: string; name: string; profile_image_url: string; skill_level: string } }).user)
        .filter(Boolean)
        .map((u) => ({
          id: u.id,
          name: u.name,
          profileImageUrl: u.profile_image_url,
          skillLevel: u.skill_level,
        }));
      setLikers(rows);
    } catch {}
    setLoadingLikers(false);
  };

  // Cancel/withdraw
  const [cancelling, setCancelling] = useState(false);
  const [showWithdrawNote, setShowWithdrawNote] = useState(false);
  const [withdrawNote, setWithdrawNote] = useState("");

  const toggleLike = async () => {
    setAnimating(true);
    const newLiked = !liked;
    setLiked(newLiked);
    setLikeCount(liked ? likeCount - 1 : likeCount + 1);
    try {
      const supabase = createSupabaseBrowserClient();
      if (newLiked) await likePost(supabase, post.id);
      else await unlikePost(supabase, post.id);
    } catch {
      setLiked(!newLiked);
      setLikeCount(liked ? likeCount + 1 : likeCount - 1);
    }
    setTimeout(() => setAnimating(false), 300);
  };

  const handleJoin = async () => {
    if (joining) return;
    setJoining(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const req = await requestToJoin(supabase, post.id);
      setMyRequest({ id: req.id, status: "PENDING", note: "" });
    } catch {
      // ignore
    }
    setJoining(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await deletePost(supabase, post.id);
      setDeleted(true);
      onDelete?.(post.id);
    } catch {
      // ignore
    }
    setDeleting(false);
  };

  const loadComments = async () => {
    const supabase = createSupabaseBrowserClient();
    const rows = await listComments(supabase, post.id);
    setComments(rows.map(toCommentCamel) as unknown as typeof comments);
    // Sync the badge with what we actually fetched. The post.commentCount
    // we initialized from is the count at the time the parent feed was
    // loaded, which goes stale the moment anyone else comments — most
    // visibly when the post author opens a "X commented on your post"
    // notification and the badge still reads 0.
    setCommentCount(rows.length);
    setCommentsLoaded(true);
  };

  useEffect(() => {
    if (initialShowComments && !commentsLoaded) loadComments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleComment = async () => {
    if (!commentInput.trim() || postingComment) return;
    setPostingComment(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const c = await addComment(supabase, post.id, commentInput);
      setComments((prev) => [...prev, toCommentCamel(c) as unknown as typeof prev[number]]);
      setCommentCount((cc) => cc + 1);
      setCommentInput("");
    } catch {
      // ignore
    }
    setPostingComment(false);
  };

  const toggleComments = () => {
    if (!showComments && !commentsLoaded) loadComments();
    setShowComments(!showComments);
  };

  if (deleted) return null;

  // Collapsed view for completed recruiting posts — highlighted confirmation
  // card. Find-players gets a chat link to the auto-created session group;
  // team requests don't have a session chat so they show a Details button.
  // Tap the main body to expand back to the full post.
  if (isCollapsible && !expanded) {
    const collapsedRole: "creator" | "player" | "bystander" = isAuthor
      ? "creator"
      : myRequest?.status === "APPROVED"
      ? "player"
      : "bystander";
    const roleStyles = isProposeTeam
      ? {
          creator: {
            container: "bg-orange-50 ring-clay/60",
            icon: "bg-clay",
            title: "text-clay",
            subtitle: "text-gray-700",
            meta: "text-gray-600",
            dot: "text-gray-400",
            button: "text-clay hover:bg-clay/10",
          },
          player: {
            container: "bg-orange-100 ring-clay/70",
            icon: "bg-clay",
            title: "text-clay",
            subtitle: "text-gray-800",
            meta: "text-gray-700",
            dot: "text-gray-500",
            button: "text-clay hover:bg-clay/10",
          },
          bystander: {
            container: "bg-gray-50 ring-gray-200",
            icon: "bg-gray-400",
            title: "text-gray-700",
            subtitle: "text-gray-600",
            meta: "text-gray-500",
            dot: "text-gray-400",
            button: "text-gray-600 hover:bg-gray-100",
          },
        }[collapsedRole]
      : {
          creator: {
            container: "bg-green-50 ring-court-green/60",
            icon: "bg-court-green",
            title: "text-court-green",
            subtitle: "text-gray-600",
            meta: "text-gray-500",
            dot: "text-gray-400",
            button: "text-court-green hover:bg-court-green/10",
          },
          player: {
            container: "bg-ball-yellow/60 ring-ball-yellow",
            icon: "bg-ball-yellow",
            title: "text-court-green",
            subtitle: "text-court-green",
            meta: "text-court-green/80",
            dot: "text-court-green/60",
            button: "text-court-green hover:bg-court-green/10",
          },
          bystander: {
            container: "bg-gray-50 ring-gray-200",
            icon: "bg-gray-400",
            title: "text-gray-600",
            subtitle: "text-gray-600",
            meta: "text-gray-500",
            dot: "text-gray-400",
            button: "text-gray-600 hover:bg-gray-100",
          },
        }[collapsedRole];
    const titleText = isProposeTeam
      ? `${isAuthor ? "Your" : `${post.author.name}'s`} Team formed`
      : `${isAuthor ? "Your" : `${post.author.name}'s`} Game confirmed`;
    return (
      <div className={`w-full rounded-2xl shadow-md ring-2 px-4 py-3 flex items-center gap-3 ${roleStyles.container}`}>
        <button
          onClick={() => setExpanded(true)}
          className="flex-1 min-w-0 flex items-center gap-3 text-left group"
          aria-label={isProposeTeam ? "Show full team details" : "Show full game details"}
        >
          <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 shadow-sm ${roleStyles.icon}`}>
            <span className="text-base leading-none">{isProposeTeam ? "🏆" : "🎾"}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-bold truncate ${roleStyles.title}`}>
                {titleText}
              </span>
              {(livePlayDate || livePlayTime) && (
                <>
                  <span className={`text-xs ${roleStyles.dot}`}>·</span>
                  <span className={`text-xs truncate capitalize font-medium ${roleStyles.subtitle}`}>
                    {livePlayDate} {livePlayTime}{endTime ? `–${endTime}` : ""}
                  </span>
                </>
              )}
            </div>
            <div className={`text-[11px] truncate mt-0.5 font-medium ${roleStyles.meta}`}>
              {liveCourtLocation || (isProposeTeam ? `${confirmed} member${confirmed === 1 ? "" : "s"}` : "Location TBD")}
              {((post.approvedPlayerNames && post.approvedPlayerNames.length > 0) || liveManualPlayers) && (
                <>
                  {" · "}
                  {[
                    ...(post.approvedPlayerNames || []),
                    ...(liveManualPlayers ? liveManualPlayers.split(",").filter((n: string) => n.trim()) : []),
                  ].map((n: string) => n.trim()).join(", ")}
                </>
              )}
            </div>
          </div>
        </button>
        {!isProposeTeam && liveSessionChatId ? (
          <Link
            href={`/chat/group/${liveSessionChatId}`}
            onClick={() => onOpenChat?.()}
            className="shrink-0 inline-flex items-center gap-1.5 bg-court-green text-white text-xs font-bold px-3 py-2 rounded-full hover:bg-court-green-light transition-colors shadow-sm"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            Open chat
          </Link>
        ) : isProposeTeam && liveTeamGroupId && collapsedRole !== "bystander" ? (
          <Link
            href={`/groups/${liveTeamGroupId}`}
            className="shrink-0 inline-flex items-center gap-1.5 bg-clay text-white text-xs font-bold px-3 py-2 rounded-full hover:opacity-90 transition-opacity shadow-sm"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9H4.5a2.5 2.5 0 010-5H6" />
              <path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
              <path d="M4 22h16" />
              <path d="M18 2H6v7a6 6 0 0012 0V2z" />
            </svg>
            Open team
          </Link>
        ) : (
          <button
            onClick={() => setExpanded(true)}
            className={`shrink-0 text-xs font-semibold px-2 py-1 rounded-full transition-colors ${roleStyles.button}`}
          >
            Details
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className={`bg-white rounded-2xl shadow-sm border overflow-hidden card-hover ${complete ? "border-green-200" : "border-court-green-pale/20"}`}>
        {/* Complete banner */}
        {complete && isRecruiting && (
          <button onClick={() => setExpanded(false)} className="w-full bg-green-50 px-5 py-2 flex items-center justify-between border-b border-green-100 hover:bg-green-100/50 transition-colors">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-green-600 shrink-0"><polyline points="20,6 9,17 4,12" /></svg>
                <span className="text-xs font-bold text-green-700 uppercase tracking-wide">{isProposeTeam ? "Team Formed — All Members Joined" : "Game Full — All Players Found"}</span>
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-green-400 shrink-0"><polyline points="18,15 12,9 6,15" /></svg>
          </button>
        )}

        {/* Author header */}
        <div className="p-5 pb-0">
          <div className="flex items-center gap-3 mb-3">
            <Link href={`/profile/${post.author.id}`}>
              <Avatar name={post.author.name} image={post.author.profileImageUrl} size="md" />
            </Link>
            <div className="flex-1 min-w-0">
              <Link href={`/profile/${post.author.id}`} className="text-sm font-semibold text-gray-900 hover:text-court-green transition-colors">
                {post.author.name}
              </Link>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-gray-400">{timeAgo(post.createdAt)}</span>
                {liveGroups.length > 0 && (
                  <>
                    <span className="text-xs text-gray-300">·</span>
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-court-green-soft">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 9H4.5a2.5 2.5 0 010-5H6" />
                        <path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
                        <path d="M4 22h16" />
                        <path d="M18 2H6v7a6 6 0 0012 0V2z" />
                      </svg>
                      {liveGroups.map((g) => g.name).join(", ")}
                    </span>
                  </>
                )}
                {liveFriendGroups.length > 0 && (
                  <>
                    <span className="text-xs text-gray-300">·</span>
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-court-green-soft">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
                      {liveFriendGroups.map((g) => g.name).join(", ")}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-0.5">
              {/* Three-dot menu for author */}
              {isAuthor && (
                <button
                  onClick={() => setShowMenu(true)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
                </button>
              )}
              {/* X button — hide others' posts from feed */}
              {!isAuthor && (
                <button
                  onClick={() => {
                    const supabase = createSupabaseBrowserClient();
                    hidePost(supabase, post.id).then(() => {
                      const res = { ok: true };
                      if (res.ok) {
                        setDeleted(true);
                        onDelete?.(post.id);
                      }
                    });
                  }}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors"
                  title="Hide from feed"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Find Players badge */}
          {isFindPlayers && (
            <div className="mb-3 flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide ${complete ? "bg-green-600 text-white" : "bg-court-green text-ball-yellow"}`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  {complete ? <polyline points="20,6 9,17 4,12" /> : <><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></>}
                </svg>
                {complete ? "Game Full" : "Looking for Players"}
              </span>
              {post.isBroadcast && (
                <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide bg-ball-yellow text-court-green">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 11a9 9 0 0118 0" />
                    <path d="M6.5 11a5.5 5.5 0 0111 0" />
                    <circle cx="12" cy="11" r="1.5" fill="currentColor" />
                    <path d="M12 13v7" />
                  </svg>
                  {isAuthor
                    ? `Broadcast · ${post.broadcastRadiusMi} mi reach`
                    : post.distanceMiles != null
                    ? `Broadcast · ${post.distanceMiles} mi away`
                    : "Broadcast"}
                </span>
              )}
            </div>
          )}

          {/* Propose Team badge */}
          {isProposeTeam && (
            <div className="mb-3">
              <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide ${complete ? "bg-green-600 text-white" : "bg-clay text-white"}`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9H4.5a2.5 2.5 0 010-5H6" />
                  <path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
                  <path d="M4 22h16" />
                  <path d="M18 2H6v7a6 6 0 0012 0V2z" />
                </svg>
                {complete ? "Team Formed" : "Recruiting Team"}
              </span>
              {liveCourtLocation && (
                <h3 className="font-display text-xl font-bold text-gray-900 mt-2">{liveCourtLocation}</h3>
              )}
            </div>
          )}

          {/* Text content */}
          {currentContent && (
            <p className="text-gray-700 text-[0.9375rem] leading-relaxed whitespace-pre-wrap break-words overflow-wrap-anywhere pb-3" style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>{currentContent}</p>
          )}

          {/* Event card (postType=event) */}
          {post.event && <EventChip event={post.event} />}

          {/* Find Players / Propose Team details card */}
          {isRecruiting && (
            <div className={`mb-3 border rounded-xl p-4 ${complete ? "bg-green-50/50 border-green-200" : isProposeTeam ? "bg-gradient-to-br from-clay/5 to-clay-light/10 border-clay/30" : "bg-gradient-to-br from-court-green/5 to-ball-yellow/10 border-court-green-pale/30"}`}>
              {isFindPlayers && (
              <div className="grid grid-cols-2 gap-3">
                {livePlayDate && (<div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-court-green-soft" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg></div><div><p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Date</p><p className="text-sm font-semibold text-gray-800">{livePlayDate}</p></div></div>)}
                {livePlayTime && (<div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-court-green-soft" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" /></svg></div><div><p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Time</p><p className="text-sm font-semibold text-gray-800">{livePlayTime}{endTime ? ` – ${endTime}` : ""}{livePlayDuration ? ` (${livePlayDuration} min)` : ""}</p></div></div>)}
                {liveCourtLocation && (<div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-court-green-soft" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg></div><div><p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Court</p><p className="text-sm font-semibold text-gray-800">{liveCourtLocation}</p></div></div>)}
                {liveGameType && (<div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-court-green-soft" strokeLinecap="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />{liveGameType === "doubles" && <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />}</svg></div><div><p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Type</p><p className="text-sm font-semibold text-gray-800 capitalize">{liveGameType}</p></div></div>)}
                {(post.skillMin != null || post.skillMax != null) && (() => {
                  const min = post.skillMin ?? 2.5;
                  const max = post.skillMax ?? 7.0;
                  const range = `${min.toFixed(1)}–${max >= 7.0 ? "5.0+" : max.toFixed(1)}`;
                  return (
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-court-green-soft" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="6 4 6 12 9 14 15 14 18 12 18 4" />
                          <line x1="6" y1="4" x2="18" y2="4" />
                          <line x1="9" y1="14" x2="9" y2="20" />
                          <line x1="15" y1="14" x2="15" y2="20" />
                          <line x1="6" y1="20" x2="18" y2="20" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Level</p>
                        <p className="text-sm font-semibold text-gray-800">NTRP {range}</p>
                      </div>
                    </div>
                  );
                })()}
              </div>
              )}
              {isProposeTeam && (
              <div className="grid grid-cols-2 gap-3">
                {liveGameType && liveGameType !== "team" && (<div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-clay" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 010-5H6" /><path d="M18 9h1.5a2.5 2.5 0 000-5H18" /><path d="M4 22h16" /><path d="M18 2H6v7a6 6 0 0012 0V2z" /></svg></div><div><p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Type</p><p className="text-sm font-semibold text-gray-800 capitalize">{({ casual: "Casual Practice", league: "Competitive League", tournament: "Tournament Prep", social: "Social / Fun", drilling: "Drilling / Training" })[liveGameType] || liveGameType}</p></div></div>)}
                {livePlayTime && livePlayTime.includes(":") && (<div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-clay" strokeLinecap="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg></div><div><p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Skill Level</p><p className="text-sm font-semibold text-gray-800">{(() => { const parts = livePlayTime.split(":"); if (parts.length !== 2) return livePlayTime; const [sys, range] = parts; const [min, max] = range.split("-"); return `${sys} ${min} – ${max}`; })()}</p></div></div>)}
                {livePlayDate && (<div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-clay" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg></div><div><p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Schedule</p><p className="text-sm font-semibold text-gray-800">{livePlayDate}</p></div></div>)}
              </div>
              )}
              <div className="mt-3 pt-3 border-t border-court-green-pale/20 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                  {liveCourtBooked && (<span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20,6 9,17 4,12" /></svg>Court Booked</span>)}
                  {livePlayersNeeded && livePlayersNeeded > 0 && (<span className="text-sm text-gray-600"><span className={`font-bold ${isProposeTeam ? "text-clay" : "text-court-green"}`}>{confirmed}</span>/{livePlayersNeeded} {isProposeTeam ? "members" : "players"}</span>)}
                </div>

                {/* Players list — approved + manual */}
                {((post.approvedPlayerNames && post.approvedPlayerNames.length > 0) || liveManualPlayers) && (
                  <div className="w-full flex items-center gap-2 flex-wrap mt-1">
                    {/* Approved players — solid green pills */}
                    {post.approvedPlayerNames?.map((name, i) => (
                      <span key={`approved-${i}`} className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <polyline points="20,6 9,17 4,12" />
                        </svg>
                        {name}
                      </span>
                    ))}
                    {/* Manual players — dashed amber pills */}
                    {liveManualPlayers && liveManualPlayers.split(",").map((name, i) => (
                      name.trim() && (
                        <span key={`manual-${i}`} className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-dashed border-amber-300 px-2 py-0.5 rounded-full">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
                          </svg>
                          {name.trim()}
                        </span>
                      )
                    ))}
                  </div>
                )}

                {!isAuthor && !complete && !myRequest && (
                  <button onClick={handleJoin} disabled={joining} className={`inline-flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${isProposeTeam ? "bg-clay hover:opacity-90" : "bg-court-green hover:bg-court-green-light"}`}>
                    {joining ? "..." : <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>{isProposeTeam ? "I'm interested" : "I'm in!"}</>}
                  </button>
                )}
                {!isAuthor && myRequest?.status === "PENDING" && (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-100 text-amber-700">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" /></svg>
                      Requested
                    </span>
                    <button
                      onClick={async () => {
                        setCancelling(true);
                        try {
                          const supabase = createSupabaseBrowserClient();
                          await cancelPlayRequest(supabase, post.id);
                          setMyRequest(null);
                        } catch {
                          // ignore
                        }
                        setCancelling(false);
                      }}
                      disabled={cancelling}
                      className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                    >
                      {cancelling ? "..." : "Cancel"}
                    </button>
                  </div>
                )}
                {!isAuthor && myRequest?.status === "APPROVED" && (
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-green-100 text-green-700">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20,6 9,17 4,12" /></svg>
                        You&apos;re in!
                      </span>
                      <button
                        onClick={() => setShowWithdrawNote(!showWithdrawNote)}
                        className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                      >
                        Withdraw
                      </button>
                    </div>
                    {showWithdrawNote && (
                      <div className="w-full mt-2 bg-white border border-gray-200 rounded-lg p-3">
                        <input
                          type="text"
                          value={withdrawNote}
                          onChange={(e) => setWithdrawNote(e.target.value)}
                          placeholder="Add a note to the organizer (optional)..."
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs mb-2"
                          autoFocus
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={async () => {
                              setCancelling(true);
                              try {
                                const supabase = createSupabaseBrowserClient();
                                await cancelPlayRequest(supabase, post.id);
                                setMyRequest({ id: myRequest.id, status: "WITHDRAWN", note: withdrawNote });
                                const newConfirmed = Math.max(0, confirmed - 1);
                                setConfirmed(newConfirmed);
                                setComplete(false);
                                setShowWithdrawNote(false);
                                onUpdate?.(post.id, { isComplete: false, playersConfirmed: newConfirmed });
                              } catch {
                                // ignore
                              }
                              setCancelling(false);
                            }}
                            disabled={cancelling}
                            className="btn-danger btn-sm"
                          >
                            {cancelling ? "..." : "Confirm Withdraw"}
                          </button>
                          <button
                            onClick={() => { setShowWithdrawNote(false); setWithdrawNote(""); }}
                            className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1"
                          >
                            Keep playing
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {!isAuthor && myRequest?.status === "REJECTED" && (<div className="text-right"><span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-100 text-red-600">Not this time</span>{myRequest.note && <p className="text-[11px] text-gray-500 mt-1 italic">&quot;{myRequest.note}&quot;</p>}</div>)}
                {!isAuthor && myRequest?.status === "WITHDRAWN" && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-100 text-gray-500">
                    Withdrawn
                  </span>
                )}
                {!isAuthor && myRequest?.status === "REMOVED" && (
                  <div className="text-right">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-100 text-red-600">
                      Removed
                    </span>
                    {myRequest.note && <p className="text-[11px] text-gray-500 mt-1 italic">&quot;{myRequest.note}&quot;</p>}
                  </div>
                )}
                {isAuthor && (
                  <button onClick={() => setShowRequests(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-court-green bg-court-green-soft/10 px-3 py-1.5 rounded-lg hover:bg-court-green-soft/20 transition-colors">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
                    View Requests
                    {(post.pendingRequestCount || 0) > 0 && (<span className="bg-ball-yellow text-court-green text-[10px] font-bold px-1.5 py-0.5 rounded-full">{post.pendingRequestCount}</span>)}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Media — photos display only, no tap-to-expand. Multi-photo
            posts still swipe horizontally via the snap carousel. */}
        {photos.length === 1 && (
          <img src={photos[0]} alt="Post image" className="w-full max-h-[500px] object-cover" />
        )}
        {photos.length > 1 && (
          <div className="relative">
            <div
              ref={photoStripRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                const idx = Math.round(el.scrollLeft / el.clientWidth);
                if (idx !== photoIndex) setPhotoIndex(idx);
              }}
              className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide"
              style={{ scrollbarWidth: "none" }}
            >
              {photos.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={`Photo ${i + 1}`}
                  className="snap-center min-w-full max-h-[500px] object-cover"
                />
              ))}
            </div>
            <div className="absolute top-3 right-3 bg-black/60 text-white text-[11px] font-semibold px-2 py-1 rounded-full pointer-events-none">
              {photoIndex + 1} / {photos.length}
            </div>
            {/* Prev / next chevrons. Desktop has no swipe gesture so the
                arrows are the only way to advance the carousel; on
                touch devices they're still usable but the snap-x scroll
                handles swipes natively. */}
            {photoIndex > 0 && (
              <button
                onClick={() => {
                  const el = photoStripRef.current;
                  if (el) el.scrollTo({ left: (photoIndex - 1) * el.clientWidth, behavior: "smooth" });
                }}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 hover:bg-white shadow-md text-gray-900 flex items-center justify-center transition-colors"
                aria-label="Previous photo"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            )}
            {photoIndex < photos.length - 1 && (
              <button
                onClick={() => {
                  const el = photoStripRef.current;
                  if (el) el.scrollTo({ left: (photoIndex + 1) * el.clientWidth, behavior: "smooth" });
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 hover:bg-white shadow-md text-gray-900 flex items-center justify-center transition-colors"
                aria-label="Next photo"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 6 15 12 9 18" />
                </svg>
              </button>
            )}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 pointer-events-none">
              {photos.map((_, i) => (
                <span
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    i === photoIndex ? "bg-white" : "bg-white/50"
                  }`}
                />
              ))}
            </div>
          </div>
        )}
        {post.mediaUrl && post.mediaType === "video" && (
          <div className="bg-black">
            <video
              src={`${post.mediaUrl}#t=0.1`}
              className="w-full max-h-[500px] object-contain"
              controls
              preload="metadata"
              playsInline
            />
          </div>
        )}

        {/* Actions: Like + Comment toggle */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <button onClick={toggleLike} className={`flex items-center text-sm font-medium transition-all ${liked ? "text-red-500" : "text-gray-400 hover:text-red-400"}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill={liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={`transition-transform ${animating ? "scale-125" : "scale-100"}`}>
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </button>
            {likeCount > 0 && (
              <button
                onClick={openLikesModal}
                className="text-sm font-medium text-gray-500 hover:text-court-green hover:underline transition-colors"
              >
                {likeCount} {likeCount === 1 ? "like" : "likes"}
              </button>
            )}
          </div>

          {!commentsOff && <button onClick={toggleComments} className="flex items-center gap-1.5 text-sm font-medium text-gray-400 hover:text-court-green-soft transition-all">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            {commentCount > 0 ? <span>{commentCount}</span> : <span className="hidden sm:inline">Comment</span>}
          </button>}
          {commentsOff && (
            <span className="text-xs text-gray-400 italic">Comments off</span>
          )}
        </div>

        {/* Comments section */}
        {showComments && (
          <div className="px-5 pb-4 border-t border-gray-100">
            {/* Existing comments */}
            {comments.length > 0 && (
              <div className="pt-3 space-y-3 mb-3">
                {comments.map((c) => (
                  <div key={c.id} className="flex items-start gap-2.5">
                    <Link href={`/profile/${c.author.id}`} className="shrink-0 mt-0.5">
                      <Avatar name={c.author.name} image={c.author.profileImageUrl} size="sm" />
                    </Link>
                    <div className="flex-1 min-w-0">
                      <div className="bg-surface/80 rounded-xl px-3.5 py-2.5">
                        <Link href={`/profile/${c.author.id}`} className="text-xs font-bold text-gray-800 hover:text-court-green transition-colors">
                          {c.author.name}
                        </Link>
                        <p className="text-sm text-gray-700 mt-0.5">{c.content}</p>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-1 ml-1">{timeAgo(c.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Comment input */}
            <div className="flex items-center gap-2 pt-2">
              <Avatar name={session?.user?.name || ""} image={session?.user?.image} size="sm" />
              <div className="flex-1 flex items-center gap-2">
                <input
                  ref={commentInputRef}
                  type="text"
                  value={commentInput}
                  onChange={(e) => setCommentInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleComment(); } }}
                  placeholder="Write a comment..."
                  className="flex-1 px-3.5 py-2 border border-gray-200 rounded-full text-sm bg-surface/50 focus:bg-white transition-colors"
                />
                <EmojiPicker open={commentEmojiOpen} onOpenChange={setCommentEmojiOpen} onSelect={insertCommentEmoji} />
                <button
                  onClick={handleComment}
                  disabled={!commentInput.trim() || postingComment}
                  className="text-court-green disabled:text-gray-300 transition-colors shrink-0"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22,2 15,22 11,13 2,9" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Manage Requests Modal */}
      {showRequests && createPortal(
        <ManageRequestsModal
          postId={post.id}
          playersNeeded={livePlayersNeeded || 0}
          currentlyComplete={complete}
          onClose={() => setShowRequests(false)}
          onUpdate={(newConfirmed, isNowComplete, sessionChatId, teamGroupId) => {
            setConfirmed(newConfirmed);
            setComplete(isNowComplete);
            if (sessionChatId) setLiveSessionChatId(sessionChatId);
            if (teamGroupId) setLiveTeamGroupId(teamGroupId);
            // Snap back to the compact confirmation card so the creator sees
            // the final state immediately, instead of staying in the tall
            // expanded view until they refresh.
            if (isNowComplete) setExpanded(false);
            onUpdate?.(post.id, { isComplete: isNowComplete, playersConfirmed: newConfirmed, sessionChatId: sessionChatId ?? undefined, teamGroupId: teamGroupId ?? undefined });
          }}
          onManualPlayersUpdate={(names) => setLiveManualPlayers(names)}
          manualPlayers={liveManualPlayers}
        />,
        document.body
      )}

      {/* Post menu popup */}
      {showMenu && createPortal(
        <div className="fixed inset-0 z-[999] bg-black/40 flex items-center justify-center p-4" onClick={() => setShowMenu(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden animate-fade-in-up" onClick={(e) => e.stopPropagation()}>
            <div className="p-3 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-800 text-center">Post Options</p>
            </div>
            <div className="py-1">
              {/* Edit */}
              <button
                onClick={() => {
                  setShowMenu(false);
                  setEditContent(currentContent);
                  setEditPlayDate(livePlayDate);
                  setEditPlayTime(livePlayTime);
                  setEditCourtLocation(liveCourtLocation);
                  setEditGameType(liveGameType);
                  setEditPlayersNeeded(livePlayersNeeded);
                  setEditCourtBooked(liveCourtBooked);
                  setEditSelectedTeamIds(new Set(liveGroups.map((g) => g.id)));
                  setEditSelectedFriendGroupIds(new Set(liveFriendGroups.map((g) => g.id)));
                  const sb = createSupabaseBrowserClient();
                  listMyGroups(sb).then((rows) => setAvailableTeams(rows.map((g) => ({ id: g.id, name: g.name }))));
                  listMyFriendGroups(sb).then((rows) => setAvailableFriendGroups(rows.map((g) => ({ id: g.id, name: g.name }))));
                  setShowEditModal(true);
                }}
                className="w-full flex items-center gap-3 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-gray-500">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Edit Post
              </button>

              {/* Toggle comments */}
              <button
                onClick={async () => {
                  const supabase = createSupabaseBrowserClient();
                  const { error: upErr } = await supabase
                    .from("posts")
                    .update({ comments_disabled: !commentsOff })
                    .eq("id", post.id);
                  if (!upErr) setCommentsOff(!commentsOff);
                  setShowMenu(false);
                }}
                className="w-full flex items-center gap-3 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                  {commentsOff && <line x1="1" y1="1" x2="23" y2="23" strokeWidth="2" />}
                </svg>
                {commentsOff ? "Turn On Comments" : "Turn Off Comments"}
              </button>

              {/* Send to Friend */}
              <button
                onClick={() => { setShowMenu(false); setShowSendToFriend(true); }}
                className="w-full flex items-center gap-3 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-gray-500">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22,2 15,22 11,13 2,9" />
                </svg>
                Send to Friend or Group
              </button>

              {/* Delete */}
              <button
                onClick={async () => {
                  setShowMenu(false);
                  handleDelete();
                }}
                disabled={deleting}
                className="w-full flex items-center gap-3 px-5 py-3 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-red-500">
                  <polyline points="3,6 5,6 21,6" />
                  <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
                {deleting ? "Deleting..." : "Delete Post"}
              </button>
            </div>

            {/* Cancel */}
            <div className="p-3 border-t border-gray-100">
              <button
                onClick={() => setShowMenu(false)}
                className="w-full py-2.5 text-sm font-semibold text-gray-500 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Edit post modal */}
      {showEditModal && createPortal(
        <div className="fixed inset-0 z-[999] bg-black/50 flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto" onClick={() => setShowEditModal(false)}>
          <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl shadow-2xl animate-fade-in-up min-h-screen sm:min-h-0 sm:my-8 flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:pt-0 sm:pb-0" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-display text-xl font-bold text-gray-900">Edit Post</h2>
              <button onClick={() => setShowEditModal(false)} className="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 hover:text-gray-700 transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="flex-1 p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Post Content</label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={4}
                  className="w-full resize-none border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 focus:bg-white transition-colors"
                  autoFocus
                />
              </div>

              {/* Find Players fields */}
              {isFindPlayers && (
                <div className="bg-gradient-to-br from-court-green/5 to-ball-yellow/10 border border-court-green-pale/30 rounded-xl p-4">
                  <h4 className="text-sm font-bold text-court-green flex items-center gap-1.5 mb-3">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                    Game Details
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Date</label>
                      <input type="date" value={editPlayDate} onChange={(e) => setEditPlayDate(e.target.value)} className="w-full min-h-[42px] px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Time</label>
                      <input type="time" lang="en-GB" value={editPlayTime} onChange={(e) => setEditPlayTime(e.target.value)} className="w-full min-h-[42px] px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Duration</label>
                      <select value={editPlayDuration} onChange={(e) => setEditPlayDuration(Number(e.target.value))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white appearance-none">
                        {[60, 75, 90, 120].map((m) => (<option key={m} value={m}>{m} min</option>))}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Court Location</label>
                      <input type="text" value={editCourtLocation} onChange={(e) => setEditCourtLocation(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Game Type</label>
                      <select value={editGameType} onChange={(e) => setEditGameType(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white appearance-none">
                        <option value="singles">Singles</option>
                        <option value="doubles">Doubles</option>
                        <option value="mixed doubles">Mixed Doubles</option>
                        <option value="practice">Practice / Rally</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Players Needed</label>
                      <select value={editPlayersNeeded} onChange={(e) => setEditPlayersNeeded(Number(e.target.value))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white appearance-none">
                        {[1, 2, 3, 4, 5, 6].map((n) => (<option key={n} value={n}>{n} {n === 1 ? "player" : "players"}</option>))}
                      </select>
                    </div>
                  </div>
                  <label className="flex items-center gap-3 mt-3 pt-3 border-t border-court-green-pale/20 cursor-pointer">
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${editCourtBooked ? "bg-court-green border-court-green" : "border-gray-300 bg-white"}`}>
                      {editCourtBooked && (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><polyline points="20,6 9,17 4,12" /></svg>)}
                    </div>
                    <input type="checkbox" checked={editCourtBooked} onChange={(e) => setEditCourtBooked(e.target.checked)} className="sr-only" />
                    <span className="text-sm font-medium text-gray-700">Court booked</span>
                  </label>
                </div>
              )}

              {/* Audience picker */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Audience</label>
                <button
                  type="button"
                  onClick={() => setShowEditAudiencePicker(true)}
                  className="w-full flex items-center justify-between gap-2 px-4 py-3 border border-gray-200 rounded-xl text-sm text-left bg-white hover:border-court-green-pale transition-colors"
                >
                  <span className="flex items-center gap-2 min-w-0 flex-1">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-court-green-soft shrink-0">
                      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
                    </svg>
                    <span className="font-medium text-gray-800 truncate">
                      {(editSelectedTeamIds.size === 0 && editSelectedFriendGroupIds.size === 0)
                        ? "All Friends"
                        : [
                            ...availableFriendGroups.filter((g) => editSelectedFriendGroupIds.has(g.id)).map((g) => g.name),
                            ...availableTeams.filter((g) => editSelectedTeamIds.has(g.id)).map((g) => g.name),
                          ].join(", ") || "All Friends"}
                    </span>
                  </span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 shrink-0">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="px-5 pb-5">
              <button
                onClick={async () => {
                  setSavingEdit(true);
                  const supabase = createSupabaseBrowserClient();
                  const updates: {
                    content: string;
                    play_date?: string;
                    play_time?: string;
                    play_duration?: number;
                    court_location?: string;
                    game_type?: string;
                    players_needed?: number;
                    court_booked?: boolean;
                  } = { content: editContent };
                  if (isFindPlayers) {
                    updates.play_date = editPlayDate;
                    updates.play_time = editPlayTime;
                    updates.play_duration = editPlayDuration;
                    updates.court_location = editCourtLocation;
                    updates.game_type = editGameType;
                    updates.players_needed = editPlayersNeeded;
                    updates.court_booked = editCourtBooked;
                  }
                  const { error: upErr } = await supabase
                    .from("posts")
                    .update(updates)
                    .eq("id", post.id);
                  if (!upErr) {
                    // Refresh post_targets: nuke + reinsert.
                    await supabase.from("post_targets").delete().eq("post_id", post.id);
                    const targetRows: { post_id: string; target_kind: "group" | "friend_group"; group_id?: string; friend_group_id?: string }[] = [];
                    for (const gid of editSelectedTeamIds) {
                      targetRows.push({ post_id: post.id, target_kind: "group", group_id: gid });
                    }
                    for (const fgid of editSelectedFriendGroupIds) {
                      targetRows.push({ post_id: post.id, target_kind: "friend_group", friend_group_id: fgid });
                    }
                    if (targetRows.length > 0) {
                      await supabase.from("post_targets").insert(targetRows);
                    }
                    setCurrentContent(editContent);
                    if (isFindPlayers) {
                      setLivePlayDate(editPlayDate);
                      setLivePlayTime(editPlayTime);
                      setLivePlayDuration(editPlayDuration);
                      setLiveCourtLocation(editCourtLocation);
                      setLiveGameType(editGameType);
                      setLivePlayersNeeded(editPlayersNeeded);
                      setLiveCourtBooked(editCourtBooked);
                    }
                    const newGroups = availableTeams.filter((g) => editSelectedTeamIds.has(g.id)).map((g) => ({ id: g.id, name: g.name }));
                    const newFriendGroups = availableFriendGroups.filter((g) => editSelectedFriendGroupIds.has(g.id)).map((g) => ({ id: g.id, name: g.name }));
                    setLiveGroups(newGroups);
                    setLiveFriendGroups(newFriendGroups);
                    onUpdate?.(post.id, { groups: newGroups, friendGroups: newFriendGroups, content: editContent });
                    setShowEditModal(false);
                  }
                  setSavingEdit(false);
                }}
                disabled={savingEdit}
                className="btn-primary w-full py-3 text-base"
              >
                {savingEdit ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Edit audience picker sub-modal */}
      {showEditAudiencePicker && createPortal(
        <div
          className="fixed inset-0 z-[1000] bg-black/40 flex items-center justify-center p-4"
          onClick={(e) => { e.stopPropagation(); setShowEditAudiencePicker(false); }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-gray-800">Post to</h3>
              <button
                onClick={() => setShowEditAudiencePicker(false)}
                className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto">
              <label className={`flex items-center gap-3 px-5 py-4 cursor-pointer transition-colors border-b border-gray-50 ${(editSelectedTeamIds.size === 0 && editSelectedFriendGroupIds.size === 0) ? "bg-court-green-soft/8" : "hover:bg-gray-50"}`}>
                <input
                  type="radio"
                  checked={editSelectedTeamIds.size === 0 && editSelectedFriendGroupIds.size === 0}
                  onChange={() => { setEditSelectedTeamIds(new Set()); setEditSelectedFriendGroupIds(new Set()); }}
                  className="sr-only"
                />
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${(editSelectedTeamIds.size === 0 && editSelectedFriendGroupIds.size === 0) ? "border-court-green bg-court-green" : "border-gray-300"}`}>
                  {(editSelectedTeamIds.size === 0 && editSelectedFriendGroupIds.size === 0) && <div className="w-2 h-2 rounded-full bg-white" />}
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

              {availableFriendGroups.length > 0 && (
                <div className="px-5 pt-3 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  Friend Groups
                </div>
              )}
              {availableFriendGroups.map((group) => {
                const checked = editSelectedFriendGroupIds.has(group.id);
                return (
                  <label key={group.id} className={`flex items-center gap-3 px-5 py-3.5 cursor-pointer transition-colors ${checked ? "bg-court-green-soft/8" : "hover:bg-gray-50"}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = new Set(editSelectedFriendGroupIds);
                        if (next.has(group.id)) next.delete(group.id);
                        else next.add(group.id);
                        setEditSelectedFriendGroupIds(next);
                      }}
                      className="sr-only"
                    />
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${checked ? "bg-court-green border-court-green" : "border-gray-300"}`}>
                      {checked && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><polyline points="20,6 9,17 4,12" /></svg>
                      )}
                    </div>
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-ball-yellow to-court-green-light flex items-center justify-center text-court-green font-bold text-xs shrink-0">
                      {group.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{group.name}</p>
                      {group._count && <p className="text-xs text-gray-400">{group._count.members} {group._count.members === 1 ? "member" : "members"}</p>}
                    </div>
                  </label>
                );
              })}

              {availableTeams.length > 0 && (
                <div className="px-5 pt-3 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  Teams
                </div>
              )}
              {availableTeams.map((group) => {
                const checked = editSelectedTeamIds.has(group.id);
                return (
                  <label key={group.id} className={`flex items-center gap-3 px-5 py-3.5 cursor-pointer transition-colors ${checked ? "bg-court-green-soft/8" : "hover:bg-gray-50"}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = new Set(editSelectedTeamIds);
                        if (next.has(group.id)) next.delete(group.id);
                        else next.add(group.id);
                        setEditSelectedTeamIds(next);
                      }}
                      className="sr-only"
                    />
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${checked ? "bg-court-green border-court-green" : "border-gray-300"}`}>
                      {checked && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><polyline points="20,6 9,17 4,12" /></svg>
                      )}
                    </div>
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-court-green to-court-green-soft flex items-center justify-center text-white font-bold text-xs shrink-0">
                      {group.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{group.name}</p>
                      {group._count && <p className="text-xs text-gray-400">{group._count.members} members</p>}
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="p-4 border-t border-gray-100">
              <button onClick={() => setShowEditAudiencePicker(false)} className="btn-primary w-full py-2.5">Done</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Likes list modal */}
      {showLikes && createPortal(
        <div
          className="fixed inset-0 z-[999] bg-black/50 flex items-center justify-center p-4"
          onClick={() => setShowLikes(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-gray-800">Likes</h3>
              <button onClick={() => setShowLikes(false)} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {loadingLikers ? (
                <div className="p-6 text-center">
                  <svg className="animate-spin w-5 h-5 text-court-green mx-auto" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                    <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                </div>
              ) : likers.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-400">No likes yet</div>
              ) : (
                likers.map((u) => (
                  <Link
                    key={u.id}
                    href={`/profile/${u.id}`}
                    onClick={() => setShowLikes(false)}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <Avatar name={u.name} image={u.profileImageUrl} size="md" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{u.name}</p>
                      <p className="text-xs text-gray-400 capitalize">{u.skillLevel}</p>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-red-500">
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                    </svg>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Send to Friend or Group modal */}
      {showSendToFriend && createPortal(
        <SendToModal
          postId={post.id}
          onClose={() => setShowSendToFriend(false)}
        />,
        document.body
      )}
    </>
  );
}

/* ────── Send to Friend or Group Modal ────── */

type SendTarget = { kind: "friend" | "group"; id: string };

function SendToModal({
  postId,
  onClose,
}: {
  postId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [friends, setFriends] = useState<{ id: string; name: string; profileImageUrl: string }[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string; imageUrl?: string; _count?: { members: number } }[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const [sentKeys, setSentKeys] = useState<Set<string>>(new Set());
  const [sendError, setSendError] = useState<string>("");

  const targetKey = (t: SendTarget) => `${t.kind}:${t.id}`;

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    Promise.all([listFriends(supabase), listMyGroups(supabase)]).then(
      ([friendRows, groupRows]) => {
        setFriends(
          friendRows.map((u) => ({
            id: u.id,
            name: u.name,
            profileImageUrl: u.profile_image_url,
          }))
        );
        setGroups(
          groupRows.map((g) => ({
            id: g.id,
            name: g.name,
            imageUrl: g.image_url,
          }))
        );
        setLoading(false);
      }
    );
  }, []);

  const send = async (target: SendTarget) => {
    const key = targetKey(target);
    setSendingKey(key);
    setSendError("");

    try {
      const supabase = createSupabaseBrowserClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Not signed in");
      if (target.kind === "friend") {
        const { error: msgErr } = await supabase.from("messages").insert({
          sender_id: auth.user.id,
          receiver_id: target.id,
          content: "",
          shared_post_id: postId,
        });
        if (msgErr) throw msgErr;
      } else {
        const { error: gmErr } = await supabase.from("group_messages").insert({
          group_id: target.id,
          sender_id: auth.user.id,
          content: "",
          shared_post_id: postId,
        });
        if (gmErr) throw gmErr;
      }
      setSentKeys((prev) => new Set(prev).add(key));
      router.push(target.kind === "friend" ? `/chat/${target.id}` : `/groups/${target.id}/chat`);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send");
      setSendingKey(null);
    }
  };

  const SendBtn = ({ target }: { target: SendTarget }) => {
    const key = targetKey(target);
    if (sentKeys.has(key)) {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-3 py-1.5 rounded-lg">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20,6 9,17 4,12" /></svg>
          Sent
        </span>
      );
    }
    return (
      <button
        onClick={() => send(target)}
        disabled={sendingKey === key}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-court-green px-3 py-1.5 rounded-lg hover:bg-court-green-light transition-colors disabled:opacity-50"
      >
        {sendingKey === key ? "..." : (
          <>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22,2 15,22 11,13 2,9" />
            </svg>
            Send
          </>
        )}
      </button>
    );
  };

  const nothingToSendTo = !loading && friends.length === 0 && groups.length === 0;

  return (
    <div className="fixed inset-0 z-[999] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in-up" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-display text-lg font-bold text-gray-800">Send to...</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {sendError && (
          <div className="px-5 py-2 bg-red-50 border-b border-red-100">
            <p className="text-xs text-red-600">{sendError}</p>
          </div>
        )}

        <div className="max-h-96 overflow-y-auto">
          {loading ? (
            <div className="p-4 space-y-3">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-12 rounded-xl" />)}</div>
          ) : nothingToSendTo ? (
            <div className="text-center py-8 px-4"><p className="text-gray-400 text-sm">No friends or groups to send to</p></div>
          ) : (
            <>
              {groups.length > 0 && (
                <>
                  <div className="px-5 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    Groups & Teams
                  </div>
                  {groups.map((g) => (
                    <div key={g.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-court-green to-court-green-soft flex items-center justify-center text-white font-bold text-sm shadow-md shrink-0">
                        {g.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{g.name}</p>
                        {g._count?.members != null && (
                          <p className="text-[11px] text-gray-400">{g._count.members} members</p>
                        )}
                      </div>
                      <SendBtn target={{ kind: "group", id: g.id }} />
                    </div>
                  ))}
                </>
              )}

              {friends.length > 0 && (
                <>
                  <div className="px-5 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    Friends
                  </div>
                  {friends.map((friend) => (
                    <div key={friend.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                      <Avatar name={friend.name} image={friend.profileImageUrl} size="md" />
                      <span className="flex-1 text-sm font-semibold text-gray-800 truncate">{friend.name}</span>
                      <SendBtn target={{ kind: "friend", id: friend.id }} />
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>

        <div className="p-3 border-t border-gray-100">
          <button onClick={onClose} className="w-full py-2.5 text-sm font-semibold text-gray-500 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/* ────── Manage Requests Modal ────── */

function ManageRequestsModal({
  postId, playersNeeded, currentlyComplete, onClose, onUpdate, onManualPlayersUpdate, manualPlayers,
}: {
  postId: string; playersNeeded: number; currentlyComplete: boolean; onClose: () => void;
  onUpdate: (confirmed: number, complete: boolean, sessionChatId?: string | null, teamGroupId?: string | null) => void;
  onManualPlayersUpdate: (names: string) => void;
  manualPlayers: string;
}) {
  const [requests, setRequests] = useState<PlayRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [rejectNoteFor, setRejectNoteFor] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [savingManual, setSavingManual] = useState(false);
  const [isMarkedFull, setIsMarkedFull] = useState(currentlyComplete);
  const [currentConfirmedCount, setCurrentConfirmedCount] = useState(0);
  const [dropdownValue, setDropdownValue] = useState(0);
  const [removeNoteFor, setRemoveNoteFor] = useState<string | null>(null);
  const [removeNote, setRemoveNote] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [showMarkFullForm, setShowMarkFullForm] = useState(false);
  const [manualNames, setManualNames] = useState<string[]>([""]);

  const loadRequests = async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase
        .from("play_requests")
        .select(
          `id, post_id, user_id, status, note, created_at, updated_at,
           user:profiles!play_requests_user_id_fkey ( id, name, profile_image_url )`
        )
        .eq("post_id", postId);
      if (error) throw error;
      // Page expects camelCase + uppercase status enum (legacy shape).
      setRequests(
        ((data ?? []) as unknown as Array<{
          id: string;
          user_id: string;
          status: "pending" | "approved" | "rejected";
          note: string;
          created_at: string;
          user: { id: string; name: string; profile_image_url: string };
        }>).map((r) => ({
          id: r.id,
          userId: r.user_id,
          status: r.status.toUpperCase(),
          note: r.note,
          createdAt: r.created_at,
          user: {
            id: r.user.id,
            name: r.user.name,
            profileImageUrl: r.user.profile_image_url,
          },
        })) as unknown as typeof requests
      );
    } catch {
      // ignore
    }
    setLoading(false);
  };

  useEffect(() => { loadRequests(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const approvedCount = requests.filter((r) => r.status === "APPROVED").length;
  const manualCount = manualPlayers
    ? manualPlayers.split(",").filter((n) => n.trim()).length
    : 0;
  const totalConfirmed = approvedCount + manualCount;

  useEffect(() => {
    setCurrentConfirmedCount(totalConfirmed);
    setDropdownValue(totalConfirmed);
  }, [totalConfirmed]);

  // The auto-create-session-chat trigger fires inside the AFTER UPDATE
  // of posts.is_complete. The trigger has committed by the time the
  // supabase-js update() resolves, so this select races nothing.
  const fetchSessionChatId = async (
    supabase: ReturnType<typeof createSupabaseBrowserClient>,
    postIdToCheck: string
  ): Promise<string | null> => {
    const { data } = await supabase
      .from("chats")
      .select("id")
      .eq("post_id", postIdToCheck)
      .maybeSingle();
    return data?.id ?? null;
  };

  const handleRespond = async (requestId: string, action: "approve" | "reject", note?: string) => {
    setRespondingTo(requestId);
    try {
      const supabase = createSupabaseBrowserClient();
      const status = action === "approve" ? "approved" : "rejected";
      const { error: upErr } = await supabase
        .from("play_requests")
        .update({ status, note: note || "" })
        .eq("id", requestId);
      if (!upErr) {
        loadRequests();
        if (action === "approve") {
          const nextConfirmed = approvedCount + 1 + manualCount;
          const isComplete = nextConfirmed >= playersNeeded;
          // Persist the count + completion flag so the auto-chat trigger
          // can fire. The legacy /api/posts/join/respond route did this
          // server-side; the migration dropped it.
          const { error: postErr } = await supabase
            .from("posts")
            .update({ players_confirmed: nextConfirmed, is_complete: isComplete })
            .eq("id", postId);
          if (!postErr) {
            const chatId = isComplete ? await fetchSessionChatId(supabase, postId) : null;
            onUpdate(nextConfirmed, isComplete, chatId, null);
            if (isComplete) onClose();
          }
        }
      }
    } catch {
      // ignore
    }
    setRespondingTo(null);
    setRejectNoteFor(null);
    setRejectNote("");
  };

  return (
    <div className="fixed inset-0 z-[999] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in-up" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="font-display text-lg font-bold text-gray-800">Player Requests</h3>
            <p className="text-xs text-gray-400">{totalConfirmed}/{playersNeeded} players confirmed</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="px-4 pt-3">
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div className="bg-court-green h-2 rounded-full transition-all" style={{ width: `${Math.min(100, (dropdownValue / playersNeeded) * 100)}%` }} />
          </div>
        </div>

        {/* Manual controls */}
        <div className="px-4 pt-3 pb-1 flex items-center justify-between gap-2 flex-wrap border-b border-gray-100 mb-1">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-gray-600">Players found:</label>
            <select
              value={dropdownValue}
              onChange={(e) => setDropdownValue(Number(e.target.value))}
              className="px-2 py-1 border border-gray-200 rounded-lg text-sm bg-white appearance-none w-14 text-center"
            >
              {Array.from({ length: playersNeeded + 1 }, (_, i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
            <span className="text-xs text-gray-400">/ {playersNeeded}</span>
          </div>
          <div className="flex items-center gap-2">
            {dropdownValue !== currentConfirmedCount && (
              <button
                onClick={async () => {
                  setSavingManual(true);
                  const isNowComplete = dropdownValue >= playersNeeded;
                  try {
                    const supabase = createSupabaseBrowserClient();
                    const { error: upErr } = await supabase
                      .from("posts")
                      .update({ players_confirmed: dropdownValue, is_complete: isNowComplete })
                      .eq("id", postId);
                    if (!upErr) {
                      const chatId = isNowComplete
                        ? await fetchSessionChatId(supabase, postId)
                        : null;
                      onUpdate(dropdownValue, isNowComplete, chatId, null);
                      setCurrentConfirmedCount(dropdownValue);
                      setIsMarkedFull(isNowComplete);
                    }
                  } catch {
                    // ignore
                  }
                  setSavingManual(false);
                }}
                disabled={savingManual}
                className="btn-primary btn-sm"
              >
                {savingManual ? "..." : "Save"}
              </button>
            )}
            {!isMarkedFull && !showMarkFullForm ? (
              <button
                onClick={() => {
                  if (approvedCount >= playersNeeded) {
                    // All slots filled by approved players, mark full directly
                    setSavingManual(true);
                    (async () => {
                      try {
                        const supabase = createSupabaseBrowserClient();
                        const { error: upErr } = await supabase
                          .from("posts")
                          .update({ players_confirmed: playersNeeded, is_complete: true })
                          .eq("id", postId);
                        if (!upErr) {
                          const chatId = await fetchSessionChatId(supabase, postId);
                          onUpdate(playersNeeded, true, chatId, null);
                          setCurrentConfirmedCount(playersNeeded);
                          setDropdownValue(playersNeeded);
                          setIsMarkedFull(true);
                        }
                      } catch {
                        // ignore
                      }
                      setSavingManual(false);
                    })();
                  } else {
                    // Has unfilled slots — pre-create one input per missing
                    // player so the user can fill them in (or leave blank →
                    // auto-named "Guest N" on submit).
                    const slots = Math.max(playersNeeded - approvedCount, 1);
                    setManualNames(Array(slots).fill(""));
                    setShowMarkFullForm(true);
                  }
                }}
                disabled={savingManual}
                className="text-xs font-semibold text-green-700 bg-green-100 hover:bg-green-200 px-3 py-1.5 rounded-lg transition-colors"
              >
                Mark Full
              </button>
            ) : isMarkedFull ? (
              <button
                onClick={async () => {
                  setSavingManual(true);
                  try {
                    const supabase = createSupabaseBrowserClient();
                    const { error: upErr } = await supabase
                      .from("posts")
                      .update({ players_confirmed: 0, is_complete: false, manual_players: "" })
                      .eq("id", postId);
                    if (!upErr) {
                      onUpdate(0, false);
                      setCurrentConfirmedCount(0);
                      setDropdownValue(0);
                      setIsMarkedFull(false);
                      onManualPlayersUpdate("");
                    }
                  } catch {
                    // ignore
                  }
                  setSavingManual(false);
                }}
                disabled={savingManual}
                className="text-xs font-semibold text-amber-700 bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded-lg transition-colors"
              >
                Reopen Game
              </button>
            ) : null}
          </div>
        </div>

        {/* Manual player names form */}
        {showMarkFullForm && (
          <div className="px-4 pt-3 pb-2 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-600 mb-1">
              {approvedCount > 0
                ? `${approvedCount} approved player${approvedCount > 1 ? "s" : ""} + ${playersNeeded - approvedCount} more needed`
                : `Enter ${playersNeeded} player names`}
            </p>
            <p className="text-[11px] text-gray-400 mb-2">Names are optional — leave blank if unknown</p>
            <div className="space-y-2">
              {manualNames.map((name, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => {
                      const next = [...manualNames];
                      next[idx] = e.target.value;
                      setManualNames(next);
                    }}
                    placeholder={`Player ${idx + 1}`}
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                    autoFocus={idx === manualNames.length - 1}
                  />
                  {manualNames.length > 1 && (
                    <button
                      onClick={() => setManualNames(manualNames.filter((_, i) => i !== idx))}
                      className="text-gray-400 hover:text-red-500 transition-colors shrink-0"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={() => setManualNames([...manualNames, ""])}
              className="flex items-center gap-1.5 text-xs font-medium text-court-green-soft hover:text-court-green mt-2 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add another player
            </button>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={async () => {
                  setSavingManual(true);
                  const guestSlots = Math.max(playersNeeded - approvedCount, manualNames.length);
                  const filled = Array.from({ length: guestSlots }, (_, i) => {
                    const typed = (manualNames[i] || "").trim();
                    return typed.length > 0 ? typed : `Guest ${i + 1}`;
                  });
                  const names = filled.join(", ");
                  try {
                    const supabase = createSupabaseBrowserClient();
                    const { error: upErr } = await supabase
                      .from("posts")
                      .update({
                        players_confirmed: playersNeeded,
                        is_complete: true,
                        manual_players: names,
                      })
                      .eq("id", postId);
                    if (!upErr) {
                      const chatId = await fetchSessionChatId(supabase, postId);
                      onUpdate(playersNeeded, true, chatId, null);
                      setCurrentConfirmedCount(playersNeeded);
                      setDropdownValue(playersNeeded);
                      setIsMarkedFull(true);
                      setShowMarkFullForm(false);
                      onManualPlayersUpdate(names);
                    }
                  } catch {
                    // ignore
                  }
                  setSavingManual(false);
                }}
                disabled={savingManual}
                className="btn-primary btn-sm"
              >
                {savingManual ? "..." : "Confirm Mark Full"}
              </button>
              <button
                onClick={() => { setShowMarkFullForm(false); setManualNames([""]); }}
                className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="max-h-96 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="skeleton h-16 rounded-xl" />)}</div>
          ) : requests.length === 0 ? (
            <div className="text-center py-8"><p className="text-gray-400 text-sm">No requests yet</p></div>
          ) : (
            requests.map((req) => (
              <div key={req.id} className={`rounded-xl border p-4 ${req.status === "APPROVED" ? "bg-green-50 border-green-200" : req.status === "REJECTED" || req.status === "WITHDRAWN" || req.status === "REMOVED" ? "bg-gray-50 border-gray-200 opacity-60" : "bg-white border-gray-200"}`}>
                <div className="flex items-center gap-3">
                  <Link href={`/profile/${req.user.id}`}><Avatar name={req.user.name} image={req.user.profileImageUrl} size="md" /></Link>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                      <span className="truncate">{req.user.name}</span>
                      <GenderSymbol gender={req.user.gender} />
                    </p>
                    <p className="text-xs text-gray-400">{formatUserRating(req.user)}</p>
                  </div>
                  {req.status === "PENDING" && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleRespond(req.id, "approve")} disabled={respondingTo === req.id || approvedCount >= playersNeeded} className="btn-primary btn-sm">{respondingTo === req.id ? "..." : "Approve"}</button>
                      <button onClick={() => setRejectNoteFor(rejectNoteFor === req.id ? null : req.id)} disabled={respondingTo === req.id} className="btn-danger btn-sm">Decline</button>
                    </div>
                  )}
                  {req.status === "APPROVED" && (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2.5 py-1 rounded-full"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20,6 9,17 4,12" /></svg>Approved</span>
                      <button
                        onClick={() => setRemoveNoteFor(removeNoteFor === req.id ? null : req.id)}
                        className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                  {req.status === "REJECTED" && (<span className="text-xs font-semibold text-gray-500">Declined</span>)}
                  {req.status === "REMOVED" && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 px-2.5 py-1 rounded-full">Removed</span>
                  )}
                  {req.status === "WITHDRAWN" && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16,17 21,12 16,7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                      Withdrawn
                    </span>
                  )}
                </div>
                {rejectNoteFor === req.id && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <input type="text" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="Add a note (optional)..." className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mb-2" autoFocus />
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleRespond(req.id, "reject", rejectNote)} disabled={respondingTo === req.id} className="btn-danger btn-sm">{respondingTo === req.id ? "..." : "Send Decline"}</button>
                      <button onClick={() => { setRejectNoteFor(null); setRejectNote(""); }} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">Cancel</button>
                    </div>
                  </div>
                )}
                {removeNoteFor === req.id && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <input
                      type="text"
                      value={removeNote}
                      onChange={(e) => setRemoveNote(e.target.value)}
                      placeholder="Message to the player (optional)..."
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mb-2"
                      autoFocus
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          setRemovingId(req.id);
                          try {
                            const supabase = createSupabaseBrowserClient();
                            const { error: upErr } = await supabase
                              .from("play_requests")
                              .update({ status: "rejected", note: removeNote })
                              .eq("id", req.id);
                            if (!upErr) {
                              const next = Math.max(0, approvedCount - 1);
                              onUpdate(next + manualCount, false);
                              setIsMarkedFull(false);
                              loadRequests();
                            }
                          } catch {
                            // ignore
                          }
                          setRemovingId(null);
                          setRemoveNoteFor(null);
                          setRemoveNote("");
                        }}
                        disabled={removingId === req.id}
                        className="btn-danger btn-sm"
                      >
                        {removingId === req.id ? "..." : "Confirm Remove"}
                      </button>
                      <button
                        onClick={() => { setRemoveNoteFor(null); setRemoveNote(""); }}
                        className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {req.status === "REJECTED" && req.note && (<p className="text-xs text-gray-500 mt-2 italic">&quot;{req.note}&quot;</p>)}
                {req.status === "WITHDRAWN" && req.note && (<p className="text-xs text-amber-600 mt-2 italic">&quot;{req.note}&quot;</p>)}
                {req.status === "REMOVED" && req.note && (<p className="text-xs text-red-500 mt-2 italic">&quot;{req.note}&quot;</p>)}
              </div>
            ))
          )}

          {/* Manually entered players */}
          {manualPlayers && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Manually Added</p>
              {manualPlayers.split(",").map((name, i) => (
                name.trim() && (
                  <div key={`mp-${i}`} className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-3 flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-bold text-sm">
                      {name.trim().charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800">{name.trim()}</p>
                      <p className="text-xs text-amber-600">Added manually</p>
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
                      </svg>
                      Manual
                    </span>
                  </div>
                )
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const EVENT_TYPE_LABEL: Record<string, { label: string; emoji: string }> = {
  tournament: { label: "Tournament", emoji: "🏆" },
  round_robin: { label: "Round Robin", emoji: "🔁" },
  ladder: { label: "Ladder", emoji: "🪜" },
  mixer: { label: "Social Mixer", emoji: "🤝" },
  clinic: { label: "Clinic", emoji: "🎾" },
  custom: { label: "Custom", emoji: "✨" },
};

function EventChip({
  event,
}: {
  event: NonNullable<Post["event"]>;
}) {
  const meta = EVENT_TYPE_LABEL[event.eventType] ?? { label: "Event", emoji: "🎾" };
  const start = new Date(event.startDate);
  const end = new Date(event.endDate);
  const sameDay = start.toDateString() === end.toDateString();
  const dateStr = sameDay
    ? `${start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${start.toLocaleTimeString(
        undefined,
        { hour: "numeric", minute: "2-digit" }
      )}`
    : `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })}`;

  return (
    <Link
      href={`/events/${event.id}`}
      className="block mb-3 rounded-xl border border-court-green-pale/30 bg-gradient-to-br from-court-green/5 to-ball-yellow/10 p-4 hover:from-court-green/10 hover:to-ball-yellow/20 transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center text-xl shadow-sm shrink-0">
          {meta.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wide text-court-green-soft mb-0.5">
            {meta.label}
          </div>
          <div className="font-display text-base font-bold text-gray-900 truncate">
            {event.title}
          </div>
          <div className="text-xs text-gray-600 mt-1 space-y-0.5">
            <div>📅 {dateStr}</div>
            {event.venueName && <div>📍 {event.venueName}</div>}
            <div className="flex items-center gap-3">
              <span>
                👤 {event.registeredCount}
                {event.maxParticipants ? `/${event.maxParticipants}` : ""} signed up
              </span>
              {(event.ntrpMin != null || event.ntrpMax != null) && (
                <span>
                  NTRP {event.ntrpMin ?? "?"}–{event.ntrpMax ?? "?"}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="text-[11px] font-semibold text-court-green shrink-0 self-center">
          View →
        </div>
      </div>
    </Link>
  );
}
