"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import PostCard from "@/components/PostCard";

type Practice = {
  id: string;
  groupId: string;
  creatorId: string;
  postId: string;
  creator: { id: string; name: string; profileImageUrl: string };
  practiceDate: string;
  practiceTime: string;
  location: string;
  playersNeeded: number;
  coach: string;
  repeats: string;
  notes: string;
  cancelled: boolean;
  createdAt: string;
};

// Loose Post type matching what /api/groups/[id] returns and what PostCard expects.
type TeamPost = Parameters<typeof PostCard>[0]["post"];

const REPEAT_LABELS: Record<string, string> = {
  "": "One-time",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
};

function formatDate(iso: string) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export default function TeamPracticePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus");
  const { data: session } = useSession();
  const groupId = params.id as string;
  const myId = session?.user?.id || "";

  // Refs for each rendered practice card so we can scrollIntoView the focused one
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const [teamName, setTeamName] = useState("");
  const [practices, setPractices] = useState<Practice[]>([]);
  const [posts, setPosts] = useState<TeamPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Compose form
  const [showCompose, setShowCompose] = useState(false);
  const [practiceDate, setPracticeDate] = useState("");
  const [practiceTime, setPracticeTime] = useState("");
  const [location, setLocation] = useState("");
  const [playersNeeded, setPlayersNeeded] = useState(2);
  const [coach, setCoach] = useState("");
  const [repeats, setRepeats] = useState("");
  const [repeatUntil, setRepeatUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [composeError, setComposeError] = useState("");

  const loadAll = async () => {
    setLoading(true);
    try {
      const [teamRes, practicesRes] = await Promise.all([
        fetch(`/api/groups/${groupId}`),
        fetch(`/api/groups/${groupId}/practices`),
      ]);
      if (!teamRes.ok) {
        setError(teamRes.status === 403 ? "You are not a member of this team." : "Failed to load team.");
        setLoading(false);
        return;
      }
      const teamData = await teamRes.json();
      setTeamName(teamData.name || "");
      setPosts(Array.isArray(teamData.posts) ? teamData.posts : []);
      if (practicesRes.ok) {
        const p = await practicesRes.json();
        setPractices(Array.isArray(p) ? p : []);
      }
    } catch {
      setError("Something went wrong.");
    }
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // Scroll to and highlight the focused practice when navigated from elsewhere (e.g. calendar)
  useEffect(() => {
    if (!focusId || loading || practices.length === 0) return;
    // Wait one tick so refs are populated
    requestAnimationFrame(() => {
      const el = cardRefs.current[focusId];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightId(focusId);
        setTimeout(() => setHighlightId(null), 2400);
      }
    });
  }, [focusId, loading, practices.length]);

  const createPractice = async () => {
    setComposeError("");
    if (!practiceDate || !location.trim() || creating) return;
    if (repeats && !repeatUntil) {
      setComposeError("Please pick an end date for the repeating practice.");
      return;
    }
    if (repeats && repeatUntil < practiceDate) {
      setComposeError("End date must be on or after the start date.");
      return;
    }
    setCreating(true);
    const res = await fetch(`/api/groups/${groupId}/practices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        practiceDate,
        practiceTime,
        location: location.trim(),
        playersNeeded,
        coach: coach.trim(),
        repeats,
        repeatUntil: repeats ? repeatUntil : undefined,
        notes: notes.trim(),
      }),
    });
    if (res.ok) {
      // Reload everything so we get the freshly created post(s) + serialization
      await loadAll();
      setShowCompose(false);
      setPracticeDate("");
      setPracticeTime("");
      setLocation("");
      setPlayersNeeded(2);
      setCoach("");
      setRepeats("");
      setRepeatUntil("");
      setNotes("");
    } else {
      const data = await res.json().catch(() => ({}));
      setComposeError(data.error || "Failed to create practice");
    }
    setCreating(false);
  };

  const cancelPractice = async (practice: Practice) => {
    const cancelling = !practice.cancelled;
    if (cancelling && !confirm("Cancel this practice? Members will see it as cancelled and join requests will be locked.")) return;
    const res = await fetch(`/api/groups/${groupId}/practices/${practice.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cancelled: cancelling }),
    });
    if (res.ok) {
      await loadAll();
    }
  };

  const deletePractice = async (practice: Practice) => {
    if (!confirm("Delete this practice permanently? This cannot be undone.")) return;
    const res = await fetch(`/api/groups/${groupId}/practices/${practice.id}`, { method: "DELETE" });
    if (res.ok) {
      setPractices((prev) => prev.filter((p) => p.id !== practice.id));
      setPosts((prev) => prev.filter((p) => p.id !== practice.postId));
    }
  };

  const postById = (postId: string) => posts.find((p) => p.id === postId);

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-500">{error}</p>
        <button onClick={() => router.back()} className="btn-primary mt-4">Go Back</button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="skeleton w-48 h-8 mb-4" />
        <div className="skeleton w-full h-32 mb-3" />
        <div className="skeleton w-full h-32" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <Link href={`/groups/${groupId}`} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15,18 9,12 15,6" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-xl font-bold text-court-green truncate">{teamName}</h1>
          <p className="text-xs text-gray-500">Team Practice</p>
        </div>
        <button
          onClick={() => setShowCompose(!showCompose)}
          className="btn-primary btn-sm inline-flex"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Propose
        </button>
      </div>

      {/* Compose form */}
      {showCompose && (
        <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-5 mb-5 animate-fade-in-up">
          <h3 className="font-display text-base font-bold text-gray-800 mb-4">Propose a Team Practice</h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Date</label>
              <input
                type="date"
                value={practiceDate}
                onChange={(e) => setPracticeDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Time</label>
              <input
                type="time"
                value={practiceTime}
                onChange={(e) => setPracticeTime(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
              />
            </div>
          </div>
          <div className="mb-3">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Location</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Court 3, Riverside Park"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Players Needed</label>
              <select
                value={playersNeeded}
                onChange={(e) => setPlayersNeeded(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white appearance-none"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Repeats</label>
              <select
                value={repeats}
                onChange={(e) => {
                  setRepeats(e.target.value);
                  if (!e.target.value) setRepeatUntil("");
                }}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white appearance-none"
              >
                <option value="">One-time</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>
          {repeats && (
            <div className="mb-3">
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Repeat Until <span className="font-normal text-gray-400">(end date, inclusive)</span>
              </label>
              <input
                type="date"
                value={repeatUntil}
                min={practiceDate || undefined}
                onChange={(e) => setRepeatUntil(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                One practice card will be created for every {REPEAT_LABELS[repeats]?.toLowerCase() || "occurrence"} between the start and end dates.
              </p>
            </div>
          )}
          <div className="mb-3">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Coach (optional)</label>
            <input
              type="text"
              value={coach}
              onChange={(e) => setCoach(e.target.value)}
              placeholder="e.g. Coach Mike"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
            />
          </div>
          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Bring extra balls"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
            />
          </div>
          {composeError && (
            <p className="text-xs text-red-500 mb-2">{composeError}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={createPractice}
              disabled={!practiceDate || !location.trim() || creating}
              className="btn-primary flex-1"
            >
              {creating ? "Posting..." : "Propose Practice"}
            </button>
            <button onClick={() => setShowCompose(false)} className="btn-secondary flex-1">Cancel</button>
          </div>
        </div>
      )}

      {/* Practice list */}
      {practices.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-court-green-pale/20">
          <div className="w-14 h-14 bg-court-green-pale/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-court-green-soft">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <h3 className="font-display text-lg font-bold text-gray-800 mb-2">No practices yet</h3>
          <p className="text-gray-500 text-sm max-w-xs mx-auto">
            Propose the first practice and let your teammates show interest in the team feed.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {practices.map((practice) => {
            const isCreator = practice.creatorId === myId;
            const linkedPost = postById(practice.postId);
            const isHighlighted = highlightId === practice.id;
            return (
              <div
                key={practice.id}
                ref={(el) => {
                  cardRefs.current[practice.id] = el;
                }}
                className={`space-y-2 rounded-2xl transition-all ${
                  isHighlighted ? "ring-4 ring-court-green/40 ring-offset-2 bg-court-green-pale/10" : ""
                }`}
              >
                {/* Practice meta strip */}
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="inline-flex items-center gap-1 bg-court-green text-white px-2 py-1 rounded-md font-semibold">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    Team Practice
                  </span>
                  {practice.coach && (
                    <span className="inline-flex items-center gap-1 bg-court-green-pale/40 text-court-green px-2 py-1 rounded-md">
                      👨‍🏫 {practice.coach}
                    </span>
                  )}
                  {practice.repeats && (
                    <span className="inline-flex items-center gap-1 bg-ball-yellow/30 text-court-green px-2 py-1 rounded-md font-medium">
                      🔁 {REPEAT_LABELS[practice.repeats] || practice.repeats}
                    </span>
                  )}
                  {practice.cancelled && (
                    <span className="text-[10px] font-bold tracking-wider text-red-600 bg-red-100 px-2 py-1 rounded uppercase">
                      Cancelled
                    </span>
                  )}
                </div>

                {/* Linked PostCard handles all interest / approve / reject / remove flows */}
                {linkedPost ? (
                  <PostCard
                    post={linkedPost}
                    onDelete={(id) => {
                      setPosts((prev) => prev.filter((p) => p.id !== id));
                      setPractices((prev) => prev.filter((p) => p.postId !== id));
                    }}
                    onUpdate={(id, updates) => {
                      setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
                    }}
                  />
                ) : (
                  <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-5">
                    <p className="text-sm font-bold text-court-green">
                      {formatDate(practice.practiceDate)}
                      {practice.practiceTime && <span className="text-gray-500 font-normal"> · {practice.practiceTime}</span>}
                    </p>
                    <p className="text-xs text-gray-600">📍 {practice.location}</p>
                    {practice.notes && <p className="text-xs text-gray-500 italic mt-2">&ldquo;{practice.notes}&rdquo;</p>}
                    <div className="flex items-center gap-2 mt-3 text-[11px] text-gray-400">
                      <Avatar name={practice.creator.name} image={practice.creator.profileImageUrl} size="sm" />
                      <span>Proposed by {practice.creator.name}</span>
                    </div>
                  </div>
                )}

                {/* Creator-only practice controls (cancel / delete) */}
                {isCreator && (
                  <div className="flex items-center gap-2 px-1">
                    <button
                      onClick={() => cancelPractice(practice)}
                      className="text-[11px] font-semibold text-amber-700 hover:text-amber-900"
                    >
                      {practice.cancelled ? "Reactivate practice" : "Cancel practice"}
                    </button>
                    <span className="text-gray-300">·</span>
                    <button
                      onClick={() => deletePractice(practice)}
                      className="text-[11px] font-semibold text-red-500 hover:text-red-700"
                    >
                      Delete practice
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
