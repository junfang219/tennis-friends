"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import { useSession } from "@/lib/supabase/nextauth-compat";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { fetchGroupBundle, getCachedGroupBundle, sendGroupMessage, placeholderInScope } from "@/lib/supabase/queries";
import { canCaptain, type TeamRole } from "@/lib/groupRoles";
import { useRealtimeTable } from "@/lib/supabase/realtime";
import {
  getPoll,
  listPollResponses,
  upsertMyResponse,
  closePoll,
  deletePoll,
  type AvailabilityPoll,
  type PollResponse,
} from "@/lib/supabase/queries/availabilityPolls";
import { rankWindows, validateBlock, type Block, type MemberResponse, type RankedWindow } from "@/lib/availabilityPoll";
import { AvailabilityTable } from "@/components/availability/AvailabilityTable";
import { RankedWindowList } from "@/components/availability/RankedWindowList";
import { SharePreferredTimesSheet } from "@/components/availability/SharePreferredTimesSheet";

type Member = {
  id: string; // group_members row id — the poll response key (member_id)
  roles: TeamRole[];
  isPlaceholder: boolean; // captain-created, no account yet
  placeholderScope: string | null;
  user: { id: string; name: string; profileImageUrl: string };
};

type Team = {
  id: string;
  name: string;
  ownerId: string;
  members: Member[];
};

export default function PollDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const groupId = params.id as string;
  const pollId = params.pollId as string;
  const myId = session?.user?.id || "";

  // Cache hydration in the lazy initializer (not an effect) so the lint rule
  // banning setState-in-effect doesn't fire — the cache is a hand-off from
  // the team page, not external state to synchronize.
  const [team, setTeam] = useState<Team | null>(() => {
    const cached = getCachedGroupBundle(groupId);
    if (!cached) return null;
    return {
      id: cached.group.id,
      name: cached.group.name,
      ownerId: cached.group.owner_id,
      members: cached.members.map((m) => ({
        id: m.id,
        roles: m.roles,
        isPlaceholder: m.isPlaceholder,
        placeholderScope: m.placeholderScope,
        user: {
          id: m.user.id,
          name: m.user.name,
          profileImageUrl: m.user.profile_image_url,
        },
      })),
    };
  });
  const [poll, setPoll] = useState<AvailabilityPoll | null>(null);
  const [responses, setResponses] = useState<PollResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // My local working copy of blocks (one map keyed by date)
  const [myBlocks, setMyBlocks] = useState<Map<string, Block[]>>(new Map());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Inline toast for transient feedback (nudge sent, nudge failed). Keyed by
  // userId so the message renders next to the right "Nudge" button.
  const [nudgedUserId, setNudgedUserId] = useState<string | null>(null);
  const [nudgeError, setNudgeError] = useState<string | null>(null);
  // Share-preferred-times sheet open state.
  const [showShareSheet, setShowShareSheet] = useState(false);

  // Initial load
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    (async () => {
      try {
        const [bundle, p, rs] = await Promise.all([
          fetchGroupBundle(supabase, groupId),
          getPoll(supabase, pollId),
          listPollResponses(supabase, pollId),
        ]);
        if (!bundle.group) {
          setError("You are not a member of this team.");
          setLoading(false);
          return;
        }
        if (!p) {
          setError("This poll no longer exists.");
          setLoading(false);
          return;
        }
        setTeam({
          id: bundle.group.id,
          name: bundle.group.name,
          ownerId: bundle.group.owner_id,
          members: bundle.members.map((m) => ({
            id: m.id,
            roles: m.roles,
            isPlaceholder: m.isPlaceholder,
            placeholderScope: m.placeholderScope,
            user: {
              id: m.user.id,
              name: m.user.name,
              profileImageUrl: m.user.profile_image_url,
            },
          })),
        });
        setPoll(p);
        setResponses(rs);
      } catch {
        setError("Something went wrong.");
      }
      setLoading(false);
    })();
  }, [groupId, pollId]);

  // My roster row (the group_members id is the poll-response key). Resolved
  // here so the my-blocks init effect below can key on it. Placeholders never
  // have an account, so they can never be "me".
  const myMember = team?.members.find((m) => !m.isPlaceholder && m.user.id === myId);
  const myMemberId = myMember?.id;

  // Initialise my-blocks from server once we have responses + my member id
  useEffect(() => {
    if (!myMemberId) return;
    const mine = responses.find((r) => r.member_id === myMemberId);
    const byDate = new Map<string, Block[]>();
    for (const b of mine?.blocks ?? []) {
      const arr = byDate.get(b.date) ?? [];
      arr.push(b);
      byDate.set(b.date, arr);
    }
    setMyBlocks(byDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myMemberId, responses.length]);

  // Realtime: re-fetch responses on any change for this poll.
  useRealtimeTable(
    {
      table: "availability_poll_responses",
      filter: `poll_id=eq.${pollId}`,
      onChange: async () => {
        const supabase = createSupabaseBrowserClient();
        try {
          const rs = await listPollResponses(supabase, pollId);
          setResponses(rs);
        } catch { /* ignore */ }
      },
    },
    [pollId],
  );

  // Realtime: poll header (status flip → close out my editor).
  useRealtimeTable(
    {
      table: "availability_polls",
      filter: `id=eq.${pollId}`,
      onChange: async () => {
        const supabase = createSupabaseBrowserClient();
        try {
          const p = await getPoll(supabase, pollId);
          if (p) setPoll(p);
        } catch { /* ignore */ }
      },
    },
    [pollId],
  );

  const isCaptain = !!team && canCaptain({ isOwner: myId === team.ownerId, roles: myMember?.roles ?? [] });
  const isOpen = poll?.status === "open";

  // Aggregate ranked windows from current server-side responses (live).
  const memberResponses: MemberResponse[] = useMemo(() => {
    if (!team) return [];
    return responses.map((r) => ({
      // userId here is an opaque identity key for the ranking algorithm. We key
      // it on member_id so account-less placeholders stay distinct.
      userId: r.member_id,
      userName: team.members.find((m) => m.id === r.member_id)?.user.name ?? r.member_id,
      blocks: r.blocks,
    }));
  }, [responses, team]);

  const ranking = useMemo(() => {
    if (!poll) return { top: [], nearMiss: [] };
    return rankWindows(
      {
        candidateDates: poll.candidate_dates,
        minBlockMinutes: poll.min_block_minutes,
        minPlayers: poll.min_players,
      },
      memberResponses,
    );
  }, [poll, memberResponses]);

  const setBlockAt = (date: string, idx: number, patch: Partial<Block>) => {
    setSaved(false);
    setMyBlocks((prev) => {
      const next = new Map(prev);
      const list = [...(next.get(date) ?? [])];
      list[idx] = { ...list[idx], ...patch };
      next.set(date, list);
      return next;
    });
  };

  const addBlockAt = (date: string) => {
    setSaved(false);
    setMyBlocks((prev) => {
      const next = new Map(prev);
      const list = [...(next.get(date) ?? [])];
      list.push({ date, start: "09:00", end: "11:00" });
      next.set(date, list);
      return next;
    });
  };

  const removeBlockAt = (date: string, idx: number) => {
    setSaved(false);
    setMyBlocks((prev) => {
      const next = new Map(prev);
      const list = [...(next.get(date) ?? [])];
      list.splice(idx, 1);
      next.set(date, list);
      return next;
    });
  };

  const saveMyAvailability = async () => {
    if (!poll || !myId || !myMember || saving) return;
    const flat: Block[] = [];
    for (const arr of myBlocks.values()) flat.push(...arr);
    for (const b of flat) {
      const err = validateBlock(b, poll.min_block_minutes);
      if (err) {
        setError(err);
        return;
      }
    }
    setSaving(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      await upsertMyResponse(supabase, { pollId: poll.id, memberId: myMember.id, userId: myId, blocks: flat });
      setSaved(true);
      setTimeout(() => setSaved(false), 2400);
    } catch {
      setError("Could not save. Try again.");
    }
    setSaving(false);
  };

  const onPickWindow = (w: RankedWindow) => {
    if (!poll) return;
    const url =
      `/groups/${groupId}/availability` +
      `?prefillDate=${encodeURIComponent(w.date)}` +
      `&prefillTime=${encodeURIComponent(w.start)}` +
      `&fromPollId=${encodeURIComponent(poll.id)}` +
      // Carry the window's members so the new match can pre-fill their
      // availability as "Playing" — they already acknowledged this slot here.
      `&prefillMembers=${encodeURIComponent(w.memberIds.join(","))}`;
    router.push(url);
  };

  const onClosePoll = async () => {
    if (!poll || !confirm("Close this poll? Members won't be able to add or change responses.")) return;
    const supabase = createSupabaseBrowserClient();
    await closePoll(supabase, { pollId: poll.id });
    const fresh = await getPoll(supabase, poll.id);
    if (fresh) setPoll(fresh);
  };

  const onDeletePoll = async () => {
    if (!poll || !confirm("Delete this poll and all responses?")) return;
    const supabase = createSupabaseBrowserClient();
    await deletePoll(supabase, poll.id);
    router.replace(`/groups/${groupId}/availability/polls`);
  };

  const onNudge = async (userId: string) => {
    if (!team) return;
    const member = team.members.find((m) => m.user.id === userId);
    if (!member) return;
    const text = `Hey @${member.user.name}, can you mark your availability on the poll "${poll?.title || "Availability"}"?`;
    setNudgeError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      await sendGroupMessage(supabase, groupId, text);
      setNudgedUserId(userId);
      setTimeout(() => setNudgedUserId((cur) => (cur === userId ? null : cur)), 2400);
    } catch {
      setNudgeError(userId);
      setTimeout(() => setNudgeError((cur) => (cur === userId ? null : cur)), 2400);
    }
  };

  if (error && !poll) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-500">{error}</p>
        <Link href={`/groups/${groupId}/availability/polls`} className="btn-primary mt-4 inline-block">
          Back to polls
        </Link>
      </div>
    );
  }

  if (loading || !poll || !team) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="skeleton w-48 h-8 mb-4" />
        <div className="skeleton w-full h-64" />
      </div>
    );
  }

  // Placeholders only belong here if they were invited to polls; real members
  // always show.
  const pollMembers = team.members.filter(
    (m) => !m.isPlaceholder || placeholderInScope(m.placeholderScope, "poll")
  );
  const respondedMemberIds = new Set(responses.map((r) => r.member_id));
  const responded = pollMembers.filter((m) => respondedMemberIds.has(m.id));
  const pending = pollMembers.filter((m) => !respondedMemberIds.has(m.id));

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <Link href={`/groups/${groupId}/availability/polls`} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15,18 9,12 15,6" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-xl font-bold text-court-green truncate">
            {poll.title || "Availability poll"}
          </h1>
          <p className="text-xs text-gray-500">
            {responded.length} of {pollMembers.length} responded · need {poll.min_players}+ players
          </p>
        </div>
        <span
          className={`text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-full whitespace-nowrap ${
            isOpen
              ? "bg-court-green-pale/30 text-court-green-dark"
              : poll.resulting_match_id
              ? "bg-ball-yellow/30 text-amber-800"
              : "bg-gray-100 text-gray-500"
          }`}
        >
          {isOpen ? "Open" : poll.resulting_match_id ? "Scheduled" : "Closed"}
        </span>
      </div>

      {/* Unified per-date table: You row (editable) + other members (read-only) */}
      <section className="mb-8">
        <h2 className="font-display text-lg font-bold text-gray-900 mb-3">
          Availability
        </h2>
        {!isOpen && (
          <p className="text-sm text-gray-500 mb-3">This poll is closed.</p>
        )}
        <AvailabilityTable
          candidateDates={poll.candidate_dates}
          responses={responses}
          members={pollMembers.map((m) => ({
            id: m.id,
            name: m.user.name,
            profileImageUrl: m.user.profileImageUrl,
          }))}
          myUserId={myMember?.id ?? ""}
          myBlocks={myBlocks}
          minBlockMinutes={poll.min_block_minutes}
          disabled={!isOpen}
          onAdd={addBlockAt}
          onChange={setBlockAt}
          onRemove={removeBlockAt}
        />
        {error && isOpen && <p className="text-sm text-red-500 mt-3">{error}</p>}
        {isOpen && (
          <button
            onClick={saveMyAvailability}
            disabled={saving}
            className="btn-primary mt-4 w-full sm:w-auto"
          >
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save my availability"}
          </button>
        )}
      </section>

      {/* Captain results */}
      {isCaptain && (
        <section className="mb-8">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="font-display text-lg font-bold text-gray-900">Ranked windows</h2>
            <button
              type="button"
              onClick={() => setShowShareSheet(true)}
              disabled={ranking.top.length + ranking.nearMiss.length === 0}
              className="text-sm font-semibold text-court-green hover:text-court-green-light disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
              Share preferred times
            </button>
          </div>
          <RankedWindowList
            windows={ranking.top}
            onPick={onPickWindow}
            emptyLabel="No windows meet the player threshold yet."
          />

          {ranking.nearMiss.length > 0 && (
            <details className="mt-5">
              <summary className="text-sm font-semibold text-gray-500 cursor-pointer">
                One player short ({ranking.nearMiss.length})
              </summary>
              <div className="mt-3">
                <RankedWindowList
                  windows={ranking.nearMiss}
                  onPick={onPickWindow}
                  emptyLabel=""
                  pickLabel="Schedule anyway"
                  tone="muted"
                />
              </div>
            </details>
          )}
        </section>
      )}

      {/* Coverage */}
      <section className="mb-8">
        <h2 className="font-display text-lg font-bold text-gray-900 mb-3">Team responses</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <h3 className="text-xs uppercase font-bold text-gray-400 mb-2">
              Responded ({responded.length})
            </h3>
            <ul className="space-y-2">
              {responded.map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  <Avatar image={m.user.profileImageUrl} name={m.user.name} size="sm" />
                  <span className="text-sm text-gray-700">{m.user.name}</span>
                </li>
              ))}
              {responded.length === 0 && <li className="text-sm text-gray-400">No responses yet.</li>}
            </ul>
          </div>
          <div>
            <h3 className="text-xs uppercase font-bold text-gray-400 mb-2">
              Pending ({pending.length})
            </h3>
            <ul className="space-y-2">
              {pending.map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  <Avatar image={m.user.profileImageUrl} name={m.user.name} size="sm" />
                  <span className="text-sm text-gray-700 flex-1">{m.user.name}</span>
                  {isCaptain && isOpen && !m.isPlaceholder && m.user.id !== myId && (
                    nudgedUserId === m.user.id ? (
                      <span className="text-xs font-semibold text-court-green">Sent ✓</span>
                    ) : nudgeError === m.user.id ? (
                      <span className="text-xs font-semibold text-red-500">Failed</span>
                    ) : (
                      <button
                        onClick={() => onNudge(m.user.id)}
                        className="text-xs font-semibold text-court-green hover:text-court-green-light"
                      >
                        Nudge
                      </button>
                    )
                  )}
                </li>
              ))}
              {pending.length === 0 && <li className="text-sm text-gray-400">Everyone&apos;s in.</li>}
            </ul>
          </div>
        </div>
      </section>

      {/* Captain actions */}
      {isCaptain && (
        <section className="border-t border-gray-100 pt-5 flex items-center gap-3">
          {isOpen && (
            <button onClick={onClosePoll} className="btn-secondary">Close poll</button>
          )}
          <button
            onClick={onDeletePoll}
            className="text-sm font-semibold text-red-500 hover:text-red-600 ml-auto"
          >
            Delete poll
          </button>
        </section>
      )}

      {isCaptain && showShareSheet && (
        <SharePreferredTimesSheet
          teamName={team.name}
          topWindows={ranking.top}
          nearMissWindows={ranking.nearMiss}
          onClose={() => setShowShareSheet(false)}
        />
      )}
    </div>
  );
}
