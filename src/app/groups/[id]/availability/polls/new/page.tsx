"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/lib/supabase/nextauth-compat";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { fetchGroupBundle, getCachedGroupBundle } from "@/lib/supabase/queries";
import { canCaptain, type TeamRole } from "@/lib/groupRoles";
import { MonthMultiPicker } from "@/components/availability/MonthMultiPicker";
import { matchWindowDates, parseSchedulingStatus } from "@/lib/matchWindow";
import { formatDateHeader } from "@/lib/lineupMessage";

export default function NewPollPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const groupId = params.id as string;
  const myId = session?.user?.id || "";
  // "Find a time" entry point: the poll is FOR an existing window/tbd match.
  const forMatchId = searchParams.get("forMatch");

  const [team, setTeam] = useState<{ ownerId: string; members: { user: { id: string }; roles: TeamRole[] }[] } | null>(() => {
    const cached = getCachedGroupBundle(groupId);
    if (!cached) return null;
    return {
      ownerId: cached.group.owner_id,
      members: cached.members.map((m) => ({ user: { id: m.user.id }, roles: m.roles })),
    };
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [title, setTitle] = useState("");
  const [dates, setDates] = useState<string[]>([]);
  const [minPlayers, setMinPlayers] = useState(4);
  const [minBlockMinutes, setMinBlockMinutes] = useState(120);
  const [submitting, setSubmitting] = useState(false);
  // The match being scheduled, when opened via "Find a time".
  const [forMatch, setForMatch] = useState<{ id: string; opponent: string; label: string } | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    (async () => {
      try {
        const bundle = await fetchGroupBundle(supabase, groupId);
        if (!bundle.group) {
          setError("You are not a member of this team.");
          setLoading(false);
          return;
        }
        setTeam({
          ownerId: bundle.group.owner_id,
          members: bundle.members.map((m) => ({ user: { id: m.user.id }, roles: m.roles })),
        });
        // Prefill from the target match: candidate dates = its play-week
        // (window) or the two weeks from its anchor (tbd), title = opponent.
        if (forMatchId) {
          const { data: m } = await supabase
            .from("team_matches")
            .select("id, opponent, match_date, window_end, scheduling_status")
            .eq("id", forMatchId)
            .eq("group_id", groupId)
            .maybeSingle();
          if (m) {
            const status = parseSchedulingStatus(m.scheduling_status);
            const label =
              status === "window"
                ? `week of ${formatDateHeader(m.match_date)}`
                : `play by ${formatDateHeader(m.match_date)}`;
            setForMatch({ id: m.id, opponent: m.opponent, label });
            setDates(matchWindowDates(m.match_date, m.window_end));
            setTitle(m.opponent ? `vs ${m.opponent} — ${label}` : `Match ${label}`);
          }
        }
      } catch {
        setError("Something went wrong.");
      }
      setLoading(false);
    })();
     
  }, [groupId, forMatchId]);

  const myMember = team?.members.find((m) => m.user.id === myId);
  const isCaptain = !!team && canCaptain({ isOwner: myId === team.ownerId, roles: myMember?.roles ?? [] });

  const toggleDate = (d: string) => {
    setDates((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort());
  };

  const submit = async () => {
    if (submitting) return;
    if (dates.length === 0) { setError("Pick at least one date."); return; }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/groups/${groupId}/polls`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          candidate_dates: dates,
          min_players: minPlayers,
          min_block_minutes: minBlockMinutes,
          timezone:
            (typeof Intl !== "undefined" && Intl.DateTimeFormat().resolvedOptions().timeZone) ||
            "America/Los_Angeles",
          for_match_id: forMatch?.id ?? undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || "Could not create poll.");
        setSubmitting(false);
        return;
      }
      router.replace(`/groups/${groupId}/availability/polls/${body.id}`);
    } catch {
      setError("Network error.");
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="skeleton w-48 h-8 mb-4" />
        <div className="skeleton w-full h-64" />
      </div>
    );
  }

  if (!isCaptain) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-500">Only captains can create availability polls.</p>
        <Link href={`/groups/${groupId}/availability/polls`} className="btn-primary mt-4 inline-block">
          Back to polls
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-5">
        <Link href={`/groups/${groupId}/availability/polls`} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15,18 9,12 15,6" />
          </svg>
        </Link>
        <h1 className="font-display text-xl font-bold text-court-green truncate">New availability poll</h1>
      </div>

      <div className="space-y-5">
        {forMatch && (
          <div className="p-3 rounded-xl border border-court-green-pale/60 bg-court-green-pale/20 text-xs text-gray-600">
            Finding a time for <strong>{forMatch.opponent ? `vs ${forMatch.opponent}` : "this match"}</strong> ({forMatch.label}).
            Once your team answers, pick the winning window — it schedules this match directly, and you
            confirm the slot with the opposing captain.
          </div>
        )}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Title (optional)</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Next two weekends"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-2">Candidate dates</label>
          <MonthMultiPicker selected={dates} onToggle={toggleDate} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Minimum players</label>
            <input
              type="number"
              min={1}
              max={20}
              value={minPlayers}
              onChange={(e) => setMinPlayers(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
            />
            <p className="text-[11px] text-gray-400 mt-1">Slots with fewer players show as near-misses.</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Minimum block length</label>
            <select
              value={minBlockMinutes}
              onChange={(e) => setMinBlockMinutes(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
            >
              <option value={120}>2 hours</option>
              <option value={150}>2.5 hours</option>
              <option value={180}>3 hours</option>
              <option value={240}>4 hours</option>
            </select>
          </div>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={submitting || dates.length === 0}
            className="btn-primary flex-1"
          >
            {submitting ? "Creating..." : "Create poll"}
          </button>
          <Link href={`/groups/${groupId}/availability/polls`} className="btn-secondary flex-1 text-center">
            Cancel
          </Link>
        </div>
      </div>
    </div>
  );
}
