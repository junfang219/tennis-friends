"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "@/lib/supabase/nextauth-compat";
import { useCachedQuery } from "@/lib/useCachedQuery";
import { availabilityRequestLabel, fetchActiveTeams, rememberLastTeam } from "@/lib/teamNavigation";

export default function TeamSwitcher({ teamId, name }: { teamId: string; name: string }) {
  const { data: session } = useSession();
  const userId = session?.user.id;
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { data } = useCachedQuery(userId ? `active-teams:${userId}` : null, () => fetchActiveTeams());
  const teams = data?.viewerId === userId ? data?.teams ?? [] : [];
  const current = teams.find(team => team.id === teamId);
  const { data: availability, isLoading: availabilityLoading } = useCachedQuery(
    open && userId ? `team-availability:${userId}` : null,
    () => fetchActiveTeams({ availability: true }),
  );

  useEffect(() => {
    if (userId && current) rememberLastTeam(userId, teamId);
  }, [userId, teamId, current]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return (
    <div ref={root} className="relative" onKeyDown={event => {
      if (event.key !== "Escape" || !open) return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }}>
      <h1 aria-label={name} className="font-display text-2xl font-bold text-gray-900">
        {teams.length > 1 && current ? (
          <button ref={trigger} type="button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(value => !value)}
            aria-label={`Switch team from ${name}`}
            className="flex min-h-11 max-w-full items-center gap-2 rounded-lg text-left text-[1.375rem] sm:text-2xl">
            <span className="min-w-0 break-words">{name}</span>
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface text-court-green" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={open ? "rotate-180" : ""}>
                <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
        ) : name}
      </h1>
      {teams.length > 1 && current && (
        <nav id={listId} aria-label="My teams" hidden={!open}
          className="absolute left-0 top-full z-20 mt-1 w-[min(20rem,calc(100vw-5.125rem))] rounded-2xl border border-gray-200 bg-white p-2 shadow-lg">
          <p className="px-2 pb-1 pt-0.5 text-sm font-semibold text-gray-600">My teams</p>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {teams.map(team => {
              const isCurrent = team.id === teamId;
              const pending = availability?.viewerId === userId
                ? availability?.teams.find(row => row.id === team.id)?.pendingAvailability
                : undefined;
              const count = pending === undefined ? null : pending
                ? availabilityRequestLabel(pending)
                : "No responses needed";
              const content = (
                <>
                  <span className="min-w-0 flex-1 break-words">
                    <span className="block font-semibold">{team.name}</span>
                    <span className="block text-xs text-gray-600">{team.role}{count && ` · ${count}`}</span>
                  </span>
                  {isCurrent && <span aria-hidden="true" className="shrink-0 font-bold">✓</span>}
                </>
              );
              const rowClass = "flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-2 py-2 text-left text-sm hover:bg-surface";
              return <li key={team.id}>{isCurrent ? (
                <button type="button" aria-current="page" className={`${rowClass} bg-surface text-court-green`}
                  onClick={() => { setOpen(false); trigger.current?.focus(); }}>
                  {content}
                </button>
              ) : (
                <Link href={`/groups/${team.id}`} className={rowClass} onNavigate={() => setOpen(false)}>
                  {content}
                </Link>
              )}</li>;
            })}
          </ul>
          {availabilityLoading && <p role="status" className="px-2 pt-1 text-xs text-gray-600">Checking availability…</p>}
        </nav>
      )}
    </div>
  );
}
