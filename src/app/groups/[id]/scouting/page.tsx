"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/lib/supabase/nextauth-compat";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  fetchGroupBundle,
  getCachedGroupBundle,
  listMyGroups,
} from "@/lib/supabase/queries";
import { canCaptain, type TeamRole } from "@/lib/groupRoles";
import {
  listOpponents,
  getOpponentPlayers,
  scoutOpponent,
  scoutLeague,
  importSchedule,
  deleteOpponent,
  linkOpponentToGroup,
  type OpponentTeam,
  type OpponentPlayer,
  type LeagueScheduleMatch,
} from "@/lib/supabase/queries/scouting";
import { errorMessage } from "@/lib/errorMessage";
import FindUstaTeam from "@/components/scouting/FindUstaTeam";

function formatFetched(iso: string | null): string {
  if (!iso) return "Never refreshed";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `Updated ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

function formatRating(p: OpponentPlayer): string {
  if (p.dynamic_rating != null) return p.dynamic_rating.toFixed(2);
  if (p.ntrp_rating != null) return p.ntrp_rating.toFixed(1);
  return "—";
}

function formatMatchDate(dateISO: string): string {
  const d = new Date(`${dateISO}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateISO;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function ScoutingPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const groupId = params.id as string;
  const myId = session?.user?.id || "";

  const [team, setTeam] = useState<{ ownerId: string; members: { user: { id: string }; roles: TeamRole[] }[] } | null>(() => {
    const cached = getCachedGroupBundle(groupId);
    if (!cached) return null;
    return {
      ownerId: cached.group.owner_id,
      members: cached.members.map((m) => ({ user: { id: m.user.id }, roles: m.roles })),
    };
  });
  const [opponents, setOpponents] = useState<OpponentTeam[]>([]);
  const [myGroups, setMyGroups] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // League scout form (primary): paste YOUR team's link once.
  const [leagueInput, setLeagueInput] = useState("");
  const [leagueBusy, setLeagueBusy] = useState(false);
  const [leagueNotices, setLeagueNotices] = useState<string[]>([]);

  // Schedule import (offered after a league scout).
  const [schedule, setSchedule] = useState<LeagueScheduleMatch[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState("");

  // Add-opponent form (secondary, manual).
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // Per-opponent expanded roster (lazily loaded), plus busy/refresh state.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rosters, setRosters] = useState<Record<string, OpponentPlayer[]>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    (async () => {
      try {
        const [bundle, opponentRows, groups] = await Promise.all([
          fetchGroupBundle(supabase, groupId),
          listOpponents(supabase, groupId),
          listMyGroups(supabase),
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
        setOpponents(opponentRows);
        setMyGroups(groups.map((g) => ({ id: g.id, name: g.name })));
      } catch {
        setError("Something went wrong.");
      }
      setLoading(false);
    })();
  }, [groupId]);

  const myMember = team?.members.find((m) => m.user.id === myId);
  const isCaptain = !!team && canCaptain({ isOwner: myId === team.ownerId, roles: myMember?.roles ?? [] });

  const ownTeam = opponents.find((o) => o.is_own) ?? null;
  const opponentRows = opponents.filter((o) => !o.is_own);

  async function handleScoutLeague(url: string) {
    if (!url.trim() || leagueBusy) return;
    setLeagueBusy(true);
    setFormError("");
    setLeagueNotices([]);
    setImportResult("");
    try {
      const result = await scoutLeague(groupId, { url: url.trim() });
      const teams = [result.ownTeam, ...result.opponents.map((o) => o.team)];
      setOpponents((prev) => {
        const incoming = new Set(teams.map((t) => t.id));
        return [...teams, ...prev.filter((o) => !incoming.has(o.id))];
      });
      setRosters((prev) => {
        const next = { ...prev, [result.ownTeam.id]: result.ownPlayers };
        for (const o of result.opponents) next[o.team.id] = o.players;
        return next;
      });
      setSchedule(result.schedule);
      setLeagueNotices(result.warnings);
      setLeagueInput("");
    } catch (err) {
      setFormError(errorMessage(err, "Could not scout the league."));
    }
    setLeagueBusy(false);
  }

  async function handleImportSchedule() {
    if (schedule.length === 0 || importBusy) return;
    setImportBusy(true);
    setImportResult("");
    try {
      const { imported, skipped } = await importSchedule(groupId, schedule);
      setImportResult(
        skipped > 0
          ? `Imported ${imported} match${imported === 1 ? "" : "es"} · ${skipped} already on the calendar`
          : `Imported ${imported} match${imported === 1 ? "" : "es"} to Availability`,
      );
    } catch (err) {
      setImportResult(errorMessage(err, "Could not import the schedule."));
    }
    setImportBusy(false);
  }

  async function reloadOpponents() {
    try {
      const supabase = createSupabaseBrowserClient();
      setOpponents(await listOpponents(supabase, groupId));
    } catch {
      // Keep current state; the import already succeeded server-side.
    }
  }

  async function loadRoster(opponentTeamId: string) {
    if (rosters[opponentTeamId]) return;
    try {
      const supabase = createSupabaseBrowserClient();
      const players = await getOpponentPlayers(supabase, opponentTeamId);
      setRosters((prev) => ({ ...prev, [opponentTeamId]: players }));
    } catch {
      // Leave roster unset; the row shows the empty-state.
    }
  }

  function toggleExpand(opponentTeamId: string) {
    if (expandedId === opponentTeamId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(opponentTeamId);
    void loadRoster(opponentTeamId);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || submitting) return;
    setSubmitting(true);
    setFormError("");
    try {
      const { team: added, players } = await scoutOpponent(groupId, { url: input.trim() });
      setOpponents((prev) => {
        const without = prev.filter((o) => o.id !== added.id);
        return [...without, added];
      });
      setRosters((prev) => ({ ...prev, [added.id]: players }));
      setExpandedId(added.id);
      setInput("");
    } catch (err) {
      setFormError(errorMessage(err, "Could not scout that team."));
    }
    setSubmitting(false);
  }

  async function handleRefresh(o: OpponentTeam) {
    setBusyId(o.id);
    try {
      const { team: refreshed, players } = await scoutOpponent(groupId, { url: o.source_url });
      setOpponents((prev) => prev.map((x) => (x.id === refreshed.id ? refreshed : x)));
      setRosters((prev) => ({ ...prev, [refreshed.id]: players }));
    } catch (err) {
      setFormError(errorMessage(err, "Could not refresh."));
    }
    setBusyId(null);
  }

  async function handleRemove(o: OpponentTeam) {
    if (!confirm(`Remove "${o.name}" from scouting?`)) return;
    setBusyId(o.id);
    try {
      const supabase = createSupabaseBrowserClient();
      await deleteOpponent(supabase, o.id);
      setOpponents((prev) => prev.filter((x) => x.id !== o.id));
    } catch (err) {
      setFormError(errorMessage(err, "Could not remove opponent."));
    }
    setBusyId(null);
  }

  async function handleLink(o: OpponentTeam, linkedGroupId: string) {
    const value = linkedGroupId || null;
    setBusyId(o.id);
    try {
      const supabase = createSupabaseBrowserClient();
      await linkOpponentToGroup(supabase, o.id, value);
      setOpponents((prev) => prev.map((x) => (x.id === o.id ? { ...x, linked_group_id: value } : x)));
    } catch (err) {
      setFormError(errorMessage(err, "Could not link team."));
    }
    setBusyId(null);
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-500">{error}</p>
        <button onClick={() => router.back()} className="btn-primary mt-4">Go Back</button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-5">
        <Link href={`/groups/${groupId}`} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15,18 9,12 15,6" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-xl font-bold text-court-green truncate">Scouting</h1>
          <p className="text-xs text-gray-500">See opponents&apos; rosters, records &amp; ratings</p>
        </div>
      </div>

      {isCaptain && (
        <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-4 mb-5">
          {ownTeam ? (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-gray-600">Scout the whole league</div>
                <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                  Re-pulls every opponent from {ownTeam.name}&apos;s schedule.
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleScoutLeague(ownTeam.source_url)}
                disabled={leagueBusy}
                className="btn-primary btn-sm whitespace-nowrap"
              >
                {leagueBusy ? "Scouting…" : "Refresh league"}
              </button>
            </div>
          ) : (
            <>
              <FindUstaTeam groupId={groupId} onImported={reloadOpponents} />
              <details className="mt-3">
                <summary className="text-xs text-gray-500 cursor-pointer select-none">
                  Or paste your team&apos;s TennisRecord link
                </summary>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleScoutLeague(leagueInput);
                  }}
                  className="mt-2"
                >
                  <div className="flex gap-2">
                    <input
                      id="tr-league-url"
                      type="text"
                      inputMode="url"
                      value={leagueInput}
                      onChange={(e) => setLeagueInput(e.target.value)}
                      placeholder="Paste YOUR team's tennisrecord link"
                      className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-court-green-soft"
                    />
                    <button type="submit" disabled={leagueBusy || !leagueInput.trim()} className="btn-secondary btn-sm whitespace-nowrap">
                      {leagueBusy ? "Scouting…" : "Scout league"}
                    </button>
                  </div>
                </form>
              </details>
            </>
          )}
          {leagueBusy && (
            <p className="text-xs text-gray-500 mt-2 animate-pulse">
              Fetching opponents from your league schedule… this can take ~30 seconds.
            </p>
          )}
          {leagueNotices.map((notice) => (
            <p key={notice} className="text-xs text-amber-600 mt-2">{notice}</p>
          ))}
          {formError && <p className="text-sm text-red-600 mt-2">{formError}</p>}

          <details className="mt-3">
            <summary className="text-xs text-gray-500 cursor-pointer select-none">
              Add one opponent manually
            </summary>
            <form onSubmit={handleAdd} className="mt-2">
              <div className="flex gap-2">
                <input
                  id="tr-url"
                  type="text"
                  inputMode="url"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Paste an opponent's tennisrecord link"
                  className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-court-green-soft"
                />
                <button type="submit" disabled={submitting || !input.trim()} className="btn-secondary btn-sm whitespace-nowrap">
                  {submitting ? "Looking up…" : "Look up"}
                </button>
              </div>
            </form>
          </details>
        </div>
      )}

      {isCaptain && schedule.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-4 mb-5">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div>
              <div className="text-sm font-semibold text-gray-800">League schedule found</div>
              <p className="text-[11px] text-gray-400">
                {schedule.length} match{schedule.length === 1 ? "" : "es"} — add them to your Availability tab.
              </p>
            </div>
            <button
              type="button"
              onClick={handleImportSchedule}
              disabled={importBusy}
              className="btn-primary btn-sm whitespace-nowrap"
            >
              {importBusy ? "Importing…" : `Import ${schedule.length} matches`}
            </button>
          </div>
          <ul className="divide-y divide-gray-100">
            {schedule.map((m) => (
              <li key={`${m.dateISO}|${m.opponentName}`} className="py-1.5 flex items-center justify-between gap-2 text-sm">
                <span className="text-gray-500 tabular-nums shrink-0">{formatMatchDate(m.dateISO)}</span>
                <span className="text-gray-900 truncate flex-1 text-right">{m.opponentName}</span>
              </li>
            ))}
          </ul>
          {importResult && <p className="text-xs text-court-green mt-2">{importResult}</p>}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <div className="skeleton w-full h-20" />
          <div className="skeleton w-full h-20" />
        </div>
      ) : opponents.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-court-green-pale/20">
          <div className="w-14 h-14 bg-court-green-pale/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-court-green-soft">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <h3 className="font-display text-lg font-bold text-gray-800 mb-2">No opponents scouted yet</h3>
          <p className="text-gray-500 text-sm max-w-xs mx-auto">
            {isCaptain
              ? "Paste YOUR team's TennisRecord link above to scout your whole league in one go."
              : "When your captain scouts an opponent, their roster shows up here."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {[...(ownTeam ? [ownTeam] : []), ...opponentRows].map((o) => {
            const expanded = expandedId === o.id;
            const roster = rosters[o.id];
            const busy = busyId === o.id;
            const linkedName = myGroups.find((g) => g.id === o.linked_group_id)?.name;
            return (
              <li key={o.id} className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleExpand(o.id)}
                  className="w-full text-left p-4 flex items-start justify-between gap-3 hover:bg-gray-50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="font-display text-base font-bold text-gray-900 truncate">{o.name}</div>
                      {o.is_own && (
                        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-court-green bg-court-green-pale/30 rounded-full px-2 py-0.5">
                          Your team
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatFetched(o.last_fetched_at)}
                      {linkedName ? ` · Linked to ${linkedName}` : ""}
                    </div>
                    {o.fetch_status === "error" && o.fetch_error && (
                      <div className="text-xs text-red-600 mt-1">{o.fetch_error}</div>
                    )}
                  </div>
                  <svg
                    width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    className={`text-gray-400 mt-1 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
                  >
                    <polyline points="6,9 12,15 18,9" />
                  </svg>
                </button>

                {expanded && (
                  <div className="px-4 pb-4">
                    {roster === undefined ? (
                      <div className="skeleton w-full h-16" />
                    ) : roster.length === 0 ? (
                      <p className="text-sm text-gray-500 py-2">No players found on this team page.</p>
                    ) : (
                      <div className="overflow-x-auto -mx-1">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-[11px] uppercase tracking-wider text-gray-400 text-left">
                              <th className="py-1.5 pr-2 font-semibold">Player</th>
                              <th className="py-1.5 px-2 font-semibold text-center">Record</th>
                              <th className="py-1.5 pl-2 font-semibold text-right">Rating</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {roster.map((p) => (
                              <tr key={p.id}>
                                <td className="py-2 pr-2 text-gray-900 truncate max-w-[55%]">{p.name}</td>
                                <td className="py-2 px-2 text-center text-gray-700 tabular-nums">{p.record_raw || "—"}</td>
                                <td className="py-2 pl-2 text-right text-gray-900 tabular-nums font-medium">{formatRating(p)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      {o.source_url && (
                        <a href={o.source_url} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm">
                          Open on TennisRecord
                        </a>
                      )}
                      {isCaptain && (
                        <>
                          <button
                            type="button"
                            onClick={() => (o.is_own ? handleScoutLeague(o.source_url) : handleRefresh(o))}
                            disabled={busy || (o.is_own && leagueBusy)}
                            className="btn-secondary btn-sm"
                          >
                            {busy || (o.is_own && leagueBusy)
                              ? "Working…"
                              : o.is_own
                                ? "Refresh league"
                                : "Refresh"}
                          </button>
                          {!o.is_own && (
                            <select
                              value={o.linked_group_id ?? ""}
                              onChange={(e) => handleLink(o, e.target.value)}
                              disabled={busy}
                              className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 max-w-[10rem]"
                              aria-label="Link to one of my teams"
                            >
                              <option value="">Link a team…</option>
                              {myGroups.map((g) => (
                                <option key={g.id} value={g.id}>{g.name}</option>
                              ))}
                            </select>
                          )}
                          <button type="button" onClick={() => handleRemove(o)} disabled={busy} className="btn-ghost btn-sm text-red-600">
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
