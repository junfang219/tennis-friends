"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/lib/supabase/nextauth-compat";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { fetchGroupBundle, getCachedGroupBundle } from "@/lib/supabase/queries";
import { canCaptain, type TeamRole } from "@/lib/groupRoles";
import { listGroupPolls, type AvailabilityPoll } from "@/lib/supabase/queries/availabilityPolls";
import { AvailabilityTabs } from "@/components/availability/AvailabilityTabs";

function formatDateRange(dates: string[]): string {
  if (dates.length === 0) return "";
  const sorted = [...dates].sort();
  const fmt = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(y, m - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  if (sorted.length === 1) return fmt(sorted[0]);
  return `${fmt(sorted[0])} – ${fmt(sorted[sorted.length - 1])} · ${sorted.length} dates`;
}

function pollStatusBadge(p: AvailabilityPoll) {
  if (p.status === "open") return { label: "Open", classes: "bg-court-green-pale/30 text-court-green-dark" };
  if (p.resulting_match_id) return { label: "Scheduled", classes: "bg-ball-yellow/30 text-amber-800" };
  return { label: "Closed", classes: "bg-gray-100 text-gray-500" };
}

export default function PollsListPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const groupId = params.id as string;
  const myId = session?.user?.id || "";

  // Cache hydration in the lazy initializer (not an effect) so the lint rule
  // banning setState-in-effect doesn't fire on a render that has nothing to
  // synchronize — the cache is just a hand-off from the team page.
  const [team, setTeam] = useState<{ ownerId: string; members: { user: { id: string }; roles: TeamRole[] }[] } | null>(() => {
    const cached = getCachedGroupBundle(groupId);
    if (!cached) return null;
    return {
      ownerId: cached.group.owner_id,
      members: cached.members.map((m) => ({ user: { id: m.user.id }, roles: m.roles })),
    };
  });
  const [polls, setPolls] = useState<AvailabilityPoll[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    (async () => {
      try {
        const [bundle, pollRows] = await Promise.all([
          fetchGroupBundle(supabase, groupId),
          listGroupPolls(supabase, groupId),
        ]);
        if (!bundle.group) {
          setError("You are not a member of this team.");
          setLoading(false);
          return;
        }
        setTeam({
          ownerId: bundle.group.owner_id,
          members: bundle.members.map((m) => ({ user: { id: m.user.id }, roles: m.roles })),
        });
        setPolls(pollRows);
      } catch {
        setError("Something went wrong.");
      }
      setLoading(false);
    })();
  }, [groupId]);

  const myMember = team?.members.find((m) => m.user.id === myId);
  const isCaptain = !!team && canCaptain({ isOwner: myId === team.ownerId, roles: myMember?.roles ?? [] });

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-500">{error}</p>
        <button onClick={() => router.back()} className="btn-primary mt-4">Go Back</button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-5">
        <Link href={`/groups/${groupId}`} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15,18 9,12 15,6" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-xl font-bold text-court-green truncate">Availability</h1>
          <p className="text-xs text-gray-500">Find dates that work for the team</p>
        </div>
        {isCaptain && (
          <Link href={`/groups/${groupId}/availability/polls/new`} className="btn-primary btn-sm inline-flex">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New poll
          </Link>
        )}
      </div>

      <AvailabilityTabs groupId={groupId} active="polls" />

      {loading ? (
        <div className="space-y-3">
          <div className="skeleton w-full h-20" />
          <div className="skeleton w-full h-20" />
        </div>
      ) : polls.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-court-green-pale/20">
          <div className="w-14 h-14 bg-court-green-pale/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-court-green-soft">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <h3 className="font-display text-lg font-bold text-gray-800 mb-2">No availability polls yet</h3>
          <p className="text-gray-500 text-sm max-w-xs mx-auto">
            {isCaptain
              ? "Create a poll to collect everyone's availability and find a time that works."
              : "When your captain starts a poll, you'll mark the times you're free here."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {polls.map((p) => {
            const badge = pollStatusBadge(p);
            return (
              <li key={p.id}>
                <Link
                  href={`/groups/${groupId}/availability/polls/${p.id}`}
                  className="block bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <div className="font-display text-base font-bold text-gray-900 truncate">
                      {p.title || formatDateRange(p.candidate_dates)}
                    </div>
                    <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-full whitespace-nowrap ${badge.classes}`}>
                      {badge.label}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatDateRange(p.candidate_dates)} · need {p.min_players} player{p.min_players === 1 ? "" : "s"}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
